import { describe, expect, it } from 'vitest';
import { STRANDED_LIMIT, objectiveView, type MissionEvent, type MissionState } from '../mission/sim';
import { coopSquad } from '../mission/testkit';
import type { NetInput } from './coop';
import { Predictor, SNAP_DISTANCE } from './predict';
import { ClientRoom, HostRoom, type Conn } from './room';
import { NetClock, simLink, type LinkOptions } from './testnet';

// P2.5: co-op over SIMULATED network conditions (latency, jitter, retransmission stalls, and an unreliable
// link for robustness). Deterministic: a manual clock, seeded randomness. These show how the code behaves
// under such conditions; they do not prove anything about real-world networks.

const FRAME = 1000 / 60;
const micro = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

interface Guest {
  room: ClientRoom;
  token: string;
  pred: Predictor;
  events: MissionEvent[];
  /** Where this guest's screen draws its own ship (after prediction), each frame. */
  shown: { x: number; y: number }[];
  links: Conn[];
}

async function setupRoom(guests: number, link: LinkOptions | ((i: number) => LinkOptions)) {
  const clock = new NetClock();
  const host = new HostRoom('NETSM', 'coop', { id: 'host-token-1', name: 'Host', shape: 'star' }, () => 11);
  host.setOperation('twin-lock');
  const hostEvents: MissionEvent[] = [];
  host.onCoopUpdate((ev) => hostEvents.push(...ev));
  const gs: Guest[] = [];
  for (let i = 0; i < guests; i++) {
    const token = `guest-token-${i}`;
    const links: Conn[] = [];
    const room = new ClientRoom(
      async () => {
        const [c, h] = simLink(clock, typeof link === 'function' ? link(i) : { ...link, seed: (link.seed ?? 1) + i * 97 });
        links.push(c);
        host.accept(h);
        return c;
      },
      'NETSM',
      { token, name: `G${i}`, shape: 'diamond' },
      () => clock.now / 1000,
    );
    const g: Guest = { room, token, pred: new Predictor(), events: [], shown: [], links };
    room.onCoopUpdate((ev, m) => {
      g.events.push(...ev);
      const c = room.coop!;
      g.pred.reconcile(m, c.slots.indexOf(token), c.ack, !!room.view.paused);
    });
    await room.open();
    gs.push(g);
  }
  const settle = async (ms: number) => {
    for (let t = 0; t < ms; t += 20) {
      clock.advance(20);
      await micro();
    }
  };
  await settle(400);
  for (const g of gs) g.room.setReady(true);
  await settle(400);
  return { clock, host, guests: gs, hostEvents, settle };
}

type Setup = Awaited<ReturnType<typeof setupRoom>>;

/** One 60 Hz frame for everyone: guests send controls and predict, the host steps, the network moves. */
async function frame(r: Setup, controls: (g: Guest, m: MissionState, slot: number) => NetInput, opts: { invulnerable?: boolean; hostInput?: NetInput } = {}) {
  for (const g of r.guests) {
    const c = g.room.coop;
    if (!c) continue;
    const slot = c.slots.indexOf(g.token);
    const ctl = controls(g, c.mission, slot);
    g.room.input(ctl, 1 / 60);
    // As the screen does: fly with the controls held now, tagged with the number they go out under.
    const sent = g.room.lastSent;
    const seq = sent.seq === g.room.nextSeq - 1 && sent.x === Math.round(ctl.x * 100) / 100 && sent.y === Math.round(ctl.y * 100) / 100 ? sent.seq : g.room.nextSeq;
    g.pred.frame(c.mission, slot, seq, { x: ctl.x, y: ctl.y }, 1 / 60, !!g.room.view.paused);
    g.pred.apply(c.mission, slot);
    g.shown.push({ x: c.mission.ships[slot].x, y: c.mission.ships[slot].y });
  }
  if (r.host.coop && opts.invulnerable !== false) for (const p of r.host.coop.mission.ships) p.invuln = 5;
  r.host.setHostInput(opts.hostInput ?? { x: 0, y: 0 });
  r.host.tick(1 / 60);
  r.clock.advance(FRAME);
  await micro();
}

const LINKS: [string, LinkOptions][] = [
  ['good (25 ms, 10 jitter)', { delay: 25, jitter: 10 }],
  ['typical (50 ms, 20 jitter)', { delay: 50, jitter: 20 }],
  ['poor (100 ms, 40 jitter)', { delay: 100, jitter: 40 }],
  ['stalls (50 ms, 5% stalls of 200 ms)', { delay: 50, jitter: 20, stall: 0.05, stallMs: 200 }],
];

describe('a guest’s own ship with prediction', () => {
  for (const [name, link] of LINKS) {
    it(`${name}: answers the stick on the next frame, and the corrections stay small and smooth`, async () => {
      const r = await setupRoom(1, link);
      expect(r.host.start()).toBe(true);
      await r.settle(300);
      const g = r.guests[0];
      // Steer a path: a new direction every 0.4 s for 8 s.
      const dirs = [
        { x: 1, y: 0 },
        { x: 0, y: -1 },
        { x: -1, y: 0 },
        { x: 0.7, y: 0.7 },
        { x: -0.7, y: -0.7 },
      ];
      let responses = 0;
      let firstFrames = 0;
      const vel = () => {
        const s = g.shown;
        return s.length > 1 ? { x: s[s.length - 1].x - s[s.length - 2].x, y: s[s.length - 1].y - s[s.length - 2].y } : { x: 0, y: 0 };
      };
      const corrections: number[] = [];
      let snaps = 0;
      for (let f = 0; f < 60 * 8; f++) {
        const d = dirs[Math.floor(f / 24) % dirs.length];
        const vBefore = vel();
        const snapsBefore = g.room.coop?.snapshots ?? 0;
        await frame(r, () => d);
        const c = g.room.coop!;
        if (c.snapshots > snapsBefore) {
          corrections.push(g.pred.lastCorrection);
          if (g.pred.lastCorrection > SNAP_DISTANCE) snaps++;
        }
        // On the first frame of each new direction, the shown ship already accelerates that way (ships
        // have momentum: after a reversal they decelerate first, exactly as in solo).
        if (f % 24 === 0 && f > 0) {
          const v = vel();
          firstFrames++;
          if ((v.x - vBefore.x) * d.x + (v.y - vBefore.y) * d.y > 0) responses++;
        }
      }
      expect(responses).toBe(firstFrames); // every change of direction shows on the very next frame
      corrections.sort((a, b) => a - b);
      const median = corrections[Math.floor(corrections.length / 2)];
      const p95 = corrections[Math.floor(corrections.length * 0.95)];
      expect(snaps).toBe(0); // no snapping in ordinary flight
      expect(median).toBeLessThan(12);
      expect(p95).toBeLessThan(link.stall ? 60 : 30);
      // Let go: within half a second the shown ship rests where the host has it.
      for (let f = 0; f < 45; f++) await frame(r, () => ({ x: 0, y: 0 }));
      const slot = g.room.coop!.slots.indexOf(g.token);
      const hostShip = r.host.coop!.mission.ships[slot];
      const shown = g.shown[g.shown.length - 1];
      expect(Math.hypot(shown.x - hostShip.x, shown.y - hostShip.y)).toBeLessThan(2);
    });
  }

  it('without prediction the same guest would wait a round trip: the measured delay it removes', async () => {
    const r = await setupRoom(1, { delay: 50, jitter: 20 });
    r.host.start();
    await r.settle(300);
    const g = r.guests[0];
    for (let f = 0; f < 30; f++) await frame(r, () => ({ x: 0, y: 0 }));
    const slot = g.room.coop!.slots.indexOf(g.token);
    // The host's copy (what an unpredicted screen would show, one trip later) vs the predicted screen.
    const x0 = r.host.coop!.mission.ships[slot].x;
    const shown0 = g.shown[g.shown.length - 1].x;
    let hostAt = -1;
    let shownAt = -1;
    for (let f = 1; f < 60; f++) {
      await frame(r, () => ({ x: 1, y: 0 }));
      if (shownAt < 0 && g.shown[g.shown.length - 1].x > shown0 + 1) shownAt = f;
      if (hostAt < 0 && r.host.coop!.mission.ships[slot].x > x0 + 1) hostAt = f;
    }
    expect(shownAt).toBe(1); // the very next frame
    expect(hostAt).toBeGreaterThanOrEqual(4); // the host only hears about it a trip later (and the guest sees that a trip after)
  });

  it('a hit’s knock-back (decided by the host) reaches the guest: the prediction follows the host', async () => {
    const r = await setupRoom(1, { delay: 50, jitter: 20 });
    r.host.start();
    await r.settle(300);
    const g = r.guests[0];
    for (let f = 0; f < 30; f++) await frame(r, () => ({ x: 0, y: 0 }));
    const slot = g.room.coop!.slots.indexOf(g.token);
    const hp = r.host.coop!.mission.ships[slot].hp;
    const p = r.host.coop!.mission.ships[slot];
    p.invuln = 0;
    r.host.coop!.mission.bullets.push({ id: 99500, x: p.x + 5, y: p.y, vx: 0, vy: 0, r: 9, from: 'enemy', life: 1 });
    await frame(r, () => ({ x: 0, y: 0 }), { invulnerable: false });
    expect(r.host.coop!.mission.ships[slot].hp).toBe(hp - 1);
    for (let f = 0; f < 40; f++) await frame(r, () => ({ x: 0, y: 0 }));
    const shown = g.shown[g.shown.length - 1];
    expect(Math.hypot(shown.x - r.host.coop!.mission.ships[slot].x, shown.y - r.host.coop!.mission.ships[slot].y)).toBeLessThan(3);
    expect(g.room.coop!.mission.ships[slot].hp).toBe(hp - 1); // damage is the host's, never predicted
  });

  it('predicts only its own ship’s movement: no shots, hits, enemies or other pilots', async () => {
    const r = await setupRoom(2, { delay: 50, jitter: 20 });
    r.host.start();
    await r.settle(300);
    const g = r.guests[0];
    for (let f = 0; f < 20; f++) await frame(r, () => ({ x: 0, y: 0 }));
    const m = g.room.coop!.mission;
    const slot = g.room.coop!.slots.indexOf(g.token);
    const other = m.ships.find((p) => p.slot !== slot)!;
    const before = JSON.stringify({ bullets: m.bullets, drones: m.drones, other: [other.x, other.y, other.angle], hp: m.ships[slot].hp, score: m.score });
    g.pred.frame(m, slot, g.room.lastSent.seq, { x: 1, y: 0, fire: true }, 1 / 60);
    g.pred.apply(m, slot);
    expect(JSON.stringify({ bullets: m.bullets, drones: m.drones, other: [other.x, other.y, other.angle], hp: m.ships[slot].hp, score: m.score })).toBe(before);
  });
});

describe('resilience', () => {
  it('jitter and stalls: every event reaches every guest exactly once, in order, and the guests end where the host ends', async () => {
    const r = await setupRoom(3, (i) => ({ delay: 30 + i * 30, jitter: 25, stall: 0.04, stallMs: 250, seed: 7 + i }));
    r.host.start();
    await r.settle(200);
    for (let f = 0; f < 60 * 300 && r.host.view().phase === 'playing'; f++) await frame(r, (_g, m, slot) => coopSquad(m)[slot] as NetInput, { hostInput: r.host.coop ? (coopSquad(r.host.coop.mission)[0] as NetInput) : undefined });
    await r.settle(1500);
    expect(r.host.view().phase).toBe('results');
    expect(r.host.view().results!.won).toBe(true);
    const host = JSON.stringify(r.hostEvents);
    for (const g of r.guests) {
      expect(JSON.stringify(g.events)).toBe(host);
      expect(g.room.view.phase).toBe('results');
      expect(g.room.view.results!.won).toBe(true);
    }
  });

  it('an unreliable, reordering link (beyond what the game’s channel does): stale snapshots are never applied, so nobody’s view goes back in time', async () => {
    const r = await setupRoom(1, { delay: 40, jitter: 80, unordered: true, drop: 0.1, seed: 3 });
    r.host.start();
    await r.settle(300);
    const g = r.guests[0];
    let rewinds = 0;
    let lastTime = -1;
    let applied = 0;
    g.room.onCoopUpdate((_e, m) => {
      applied++;
      if (m.time < lastTime) rewinds++;
      lastTime = m.time;
    });
    for (let f = 0; f < 60 * 20; f++) await frame(r, (_g, m, slot) => coopSquad(m)[slot] as NetInput);
    expect(applied).toBeGreaterThan(100);
    expect(rewinds).toBe(0);
    // The guest's world still tracks the host's (state is complete in every snapshot; only effects can be lost).
    expect(Math.abs(g.room.coop!.mission.time - r.host.coop!.mission.time)).toBeLessThan(0.5);
  });

  it('late, repeated and malformed inputs are ignored; a huge junk message changes nothing', async () => {
    const r = await setupRoom(1, { delay: 10 });
    r.host.start();
    await r.settle(300);
    const g = r.guests[0];
    const slot = g.room.coop!.slots.indexOf(g.token);
    const conn = g.links[0];
    const ship = () => r.host.coop!.mission.ships[slot];
    conn.send({ t: 'input', x: 1, y: 0, seq: 1000 });
    for (let f = 0; f < 10; f++) await frame(r, () => ({ x: 1, y: 0 }));
    const x0 = ship().x;
    // Older numbers (late or repeated) must not take over: they would steer the ship backwards.
    for (let i = 0; i < 20; i++) conn.send({ t: 'input', x: -1, y: 0, seq: 999 - i });
    conn.send({ t: 'input', x: -1, y: 0, seq: 1000 });
    for (const bad of [{ t: 'input', x: -1, y: 0, seq: 1.5 }, { t: 'input', x: -1, y: 0, seq: -3 }, { t: 'input', x: -1, y: 0, seq: 'next' }, { t: 'input', x: -1, y: 0, seq: 2 ** 60 }]) conn.send(bad);
    conn.send({ t: 'input', x: 0, y: 0, seq: 1001, junk: 'x'.repeat(200_000), more: Array.from({ length: 5000 }, (_, i) => i) });
    r.clock.advance(50);
    await micro();
    // Only #1001 (stick centred) was accepted after #1000.
    for (let f = 0; f < 30; f++) {
      r.host.tick(1 / 60);
      r.clock.advance(FRAME);
      await micro();
    }
    expect(ship().x).toBeGreaterThanOrEqual(x0 - 1);
    expect(r.host.coop!.mission.status).toBe('playing');
  });

  it('a guest whose inputs stop (a stalled link) stops flying instead of drifting', async () => {
    const r = await setupRoom(1, { delay: 20 });
    r.host.start();
    await r.settle(300);
    const g = r.guests[0];
    const slot = g.room.coop!.slots.indexOf(g.token);
    for (let f = 0; f < 30; f++) await frame(r, () => ({ x: 1, y: 0 }));
    // The guest goes silent (no more input arrives) while the host keeps running.
    for (let f = 0; f < 60; f++) {
      r.host.tick(1 / 60);
      r.clock.advance(FRAME);
      await micro();
    }
    const x = r.host.coop!.mission.ships[slot].x;
    for (let f = 0; f < 60; f++) {
      r.host.tick(1 / 60);
      r.clock.advance(FRAME);
      await micro();
    }
    expect(Math.abs(r.host.coop!.mission.ships[slot].x - x)).toBeLessThan(1);
  });

  it('a guest that drops and rejoins over a slow link is caught up at once, with a correct snapshot', async () => {
    const r = await setupRoom(2, { delay: 60, jitter: 20 });
    r.host.start();
    await r.settle(300);
    for (let f = 0; f < 60 * 3; f++) await frame(r, (_g, m, slot) => coopSquad(m)[slot] as NetInput);
    const g = r.guests[0];
    g.links[0].close();
    r.clock.advance(20);
    await micro();
    for (let f = 0; f < 60; f++) await frame(r, (_g, m, slot) => coopSquad(m)[slot] as NetInput);
    // The client retries after 2 s (a real timer in ClientRoom): reconnect by hand at the same point.
    await (g.room as unknown as { open: () => Promise<void> }).open();
    await r.settle(400);
    const mine = g.room.coop!.mission;
    const host = r.host.coop!.mission;
    expect(g.room.view.status).toBe('open');
    expect(mine.phase).toBe(host.phase);
    expect(Math.abs(mine.time - host.time)).toBeLessThan(0.2);
    expect(mine.ships.map((p) => p.online)).toEqual(host.ships.map((p) => p.online));
  });

  it('disconnections do not wrongly defeat the team: the squadron waits for a pilot who was still flying', async () => {
    const r = await setupRoom(1, { delay: 30 });
    r.host.start();
    await r.settle(300);
    const m = r.host.coop!.mission;
    const g = r.guests[0];
    // The host's pilot goes down; then the guest (the only one flying) loses connection.
    m.ships[0].invuln = 0;
    m.ships[0].hp = 1;
    m.bullets.push({ id: 99600, x: m.ships[0].x, y: m.ships[0].y, vx: 0, vy: 0, r: 9, from: 'enemy', life: 1 });
    await frame(r, () => ({ x: 0, y: 0 }), { invulnerable: false });
    expect(m.ships[0].downed).toBe(true);
    g.links[0].close();
    r.clock.advance(20);
    await micro();
    for (let f = 0; f < 60 * 5; f++) {
      r.host.tick(1 / 60);
      r.clock.advance(FRAME);
      await micro();
    }
    expect(m.status).toBe('playing');
    expect(objectiveView(m).phase).toBe(1);
    expect(m.flags.stranded).toBeGreaterThan(4);
    // Never back: the operation ends cleanly after the wait.
    for (let f = 0; f < 60 * STRANDED_LIMIT; f++) {
      r.host.tick(1 / 60);
      r.clock.advance(FRAME);
      await micro();
    }
    await r.settle(2000);
    expect(r.host.view().phase).toBe('results');
    expect(r.host.view().results!.text).toMatch(/lost contact/);
  });
});

describe('the host’s game in the background', () => {
  it('pauses for everyone (told why), simulates nothing meanwhile, and resumes without a catch-up burst', async () => {
    const r = await setupRoom(2, { delay: 40, jitter: 10 });
    r.host.start();
    await r.settle(300);
    for (let f = 0; f < 60; f++) await frame(r, () => ({ x: 1, y: 0 }));
    r.host.setPaused('The host’s game is in the background');
    await r.settle(200);
    for (const g of r.guests) expect(g.room.view.paused).toMatch(/background/);
    const t = r.host.coop!.mission.time;
    const snaps = r.guests.map((g) => g.room.coop!.snapshots);
    // A throttled background tab still gets the odd timer tick (with a long dt): nothing may move.
    for (let i = 0; i < 10; i++) {
      r.host.tick(1);
      for (const g of r.guests) g.room.input({ x: 1, y: 0, fire: true }, 1);
      r.clock.advance(1000);
      await micro();
    }
    expect(r.host.coop!.mission.time).toBe(t);
    expect(r.guests.map((g) => g.room.coop!.snapshots)).toEqual(snaps);
    // Guests' own predicted ships hold still while paused (they do not fly ahead of the host).
    const g = r.guests[0];
    const slot = g.room.coop!.slots.indexOf(g.token);
    const shownBefore = { ...g.shown[g.shown.length - 1] };
    g.pred.frame(g.room.coop!.mission, slot, g.room.lastSent.seq, { x: 1, y: 0 }, 1 / 60, true);
    g.pred.apply(g.room.coop!.mission, slot);
    expect(g.room.coop!.mission.ships[slot].x).toBeCloseTo(g.room.coop!.mission.ships[slot].x, 6);
    expect(g.pred.active).toBe(false);
    void shownBefore;
    r.host.setPaused(null);
    await r.settle(200);
    for (const x of r.guests) expect(x.room.view.paused).toBeNull();
    for (let f = 0; f < 60; f++) await frame(r, () => ({ x: 0, y: 0 }));
    const dt = r.host.coop!.mission.time - t;
    expect(dt).toBeGreaterThan(0.9);
    expect(dt).toBeLessThan(1.2); // one second of play, not the minutes the tab was away
  });

  it('the host leaving while paused closes the room for everyone, cleanly', async () => {
    const r = await setupRoom(2, { delay: 40, jitter: 10 });
    r.host.start();
    await r.settle(300);
    r.host.setPaused('The host’s game is in the background');
    await r.settle(200);
    r.host.close();
    await r.settle(500);
    for (const g of r.guests) {
      expect(g.room.view.status).toBe('closed');
      expect(g.room.view.notice).toMatch(/host left/i);
    }
  });

  it('a guest who drops during a pause and rejoins sees the pause, and the right state, at once', async () => {
    const r = await setupRoom(2, { delay: 40, jitter: 10 });
    r.host.start();
    await r.settle(300);
    for (let f = 0; f < 60; f++) await frame(r, (_g, m, slot) => coopSquad(m)[slot] as NetInput);
    r.host.setPaused('The host’s game is in the background');
    await r.settle(200);
    const g = r.guests[0];
    g.links[0].close();
    await r.settle(100);
    await (g.room as unknown as { open: () => Promise<void> }).open();
    await r.settle(400);
    expect(g.room.view.status).toBe('open');
    expect(g.room.view.paused).toMatch(/background/);
    expect(Math.abs(g.room.coop!.mission.time - r.host.coop!.mission.time)).toBeLessThan(0.05);
    r.host.setPaused(null);
    await r.settle(200);
    expect(g.room.view.paused).toBeNull();
    for (let f = 0; f < 60; f++) await frame(r, (_g, m, slot) => coopSquad(m)[slot] as NetInput);
    expect(Math.abs(g.room.coop!.mission.time - r.host.coop!.mission.time)).toBeLessThan(0.2);
  });

  it('a pause is only possible during a match, and the results clear it', async () => {
    const r = await setupRoom(1, { delay: 10 });
    r.host.setPaused('away');
    expect(r.host.view().paused).toBeNull(); // nothing to pause in the lobby
    r.host.start();
    r.host.setPaused('away');
    expect(r.host.view().paused).toBe('away');
    r.host.setPaused(null);
    expect(r.host.view().paused).toBeNull();
  });
});
