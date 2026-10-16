import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MATCH_MODES, createMatch, setConnected, snapshot, standings, stepMatch, type Match } from './match';
import { ClientRoom, HostRoom, cleanName, makeRoomCode, normaliseCode, type Conn, type RoomView } from './room';

const roster = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, shape: 'square', color: i }));
const still = (m: Match) => Object.fromEntries(m.players.map((p) => [p.id, { x: 0, y: 0 }]));

describe('multiplayer match simulation (runs on the host only)', () => {
  it('is deterministic for the same seed and inputs', () => {
    const a = createMatch(42, 'lps', roster(3));
    const b = createMatch(42, 'lps', roster(3));
    for (let i = 0; i < 600; i++) {
      stepMatch(a, still(a), 1 / 60);
      stepMatch(b, still(b), 1 / 60);
    }
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it('clamps oversized input so nobody can move faster than everyone else', () => {
    const m = createMatch(1, 'coop', roster(2));
    m.spawnTimer = Infinity;
    const x0 = m.players[0].x;
    const x1 = m.players[1].x;
    for (let i = 0; i < 30; i++) stepMatch(m, { p0: { x: 50, y: 0 }, p1: { x: 1, y: 0 } }, 1 / 60);
    expect(m.players[0].x - x0).toBeCloseTo(m.players[1].x - x1, 5);
  });

  it('Last Player Standing ends with the survivor as the winner', () => {
    const m = createMatch(7, 'lps', roster(3));
    m.spawnTimer = Infinity;
    m.players[0].graceUntil = m.players[1].graceUntil = 0;
    m.hazards.push({ x: m.players[0].x, y: m.players[0].y, vx: 0, vy: 0, r: 10, seek: false });
    m.hazards.push({ x: m.players[1].x, y: m.players[1].y, vx: 0, vy: 0, r: 10, seek: false });
    m.time = 3;
    stepMatch(m, still(m), 1 / 60);
    expect(m.status).toBe('over');
    expect(m.outcome!.winners).toEqual(['p2']);
    expect(standings(m)[0].id).toBe('p2');
  });

  it('a player who disconnects in Last Player Standing is eliminated', () => {
    const m = createMatch(7, 'lps', roster(2));
    setConnected(m, 'p0', false);
    expect(m.status).toBe('over');
    expect(m.outcome!.winners).toEqual(['p1']);
  });

  it('Orb Race: orbs can be collected and the most orbs wins at the whistle', () => {
    const m = createMatch(3, 'orbs', roster(2));
    m.spawnTimer = Infinity;
    expect(m.orbs.length).toBe(3);
    const o = m.orbs[0];
    m.players[1].x = o.x;
    m.players[1].y = o.y;
    stepMatch(m, still(m), 1 / 60);
    expect(m.players[1].orbs).toBe(1);
    expect(m.orbs.length).toBe(3); // replaced
    m.time = 60;
    stepMatch(m, still(m), 1 / 60);
    expect(m.outcome!.winners).toEqual(['p1']);
  });

  it('Co-op: downed players come back while a teammate stands; the team wins at 2 minutes', () => {
    const m = createMatch(9, 'coop', roster(2));
    m.spawnTimer = Infinity;
    m.players[0].alive = false;
    m.players[0].downAt = 0;
    m.time = 4.9;
    stepMatch(m, still(m), 0.2);
    expect(m.players[0].alive).toBe(true);
    m.time = 119.99;
    stepMatch(m, still(m), 0.02);
    expect(m.status).toBe('over');
    expect(m.outcome).toMatchObject({ team: true, won: true });
  });

  it('every mode stays playable with idle players for a while (no instant deaths)', () => {
    for (const mode of MATCH_MODES) {
      const m = createMatch(11, mode.id, roster(2));
      for (let i = 0; i < 120; i++) stepMatch(m, still(m), 1 / 60);
      expect(m.status, mode.id).toBe('playing');
    }
  });
});

describe('room codes and names', () => {
  it('codes are 5 unambiguous characters and parse back case-insensitively', () => {
    const code = makeRoomCode(() => 0.5);
    expect(code).toHaveLength(5);
    expect(normaliseCode(code.toLowerCase())).toBe(code);
    expect(normaliseCode(' ab-cd e ')).toBe('ABCDE');
    expect(normaliseCode('ABCD0')).toBeNull(); // 0 is not used
    expect(normaliseCode('ABC')).toBeNull();
  });

  it('player names are cleaned before anyone else sees them', () => {
    expect(cleanName('  Neo\u0000‮  ')).toBe('Neo');
    expect(cleanName('x'.repeat(40))).toHaveLength(16);
    expect(cleanName(42)).toBe('Player');
  });
});

// ---------- An in-memory network (for unit tests; the browser uses PeerJS/WebRTC) ----------

function pipe(): [Conn, Conn] {
  const make = () => ({ data: [] as ((m: unknown) => void)[], close: [] as (() => void)[], open: true });
  const a = make();
  const b = make();
  const end = (me: typeof a, other: typeof a): Conn => ({
    send: (m) => {
      if (!me.open) return;
      const copy = JSON.parse(JSON.stringify(m));
      queueMicrotask(() => other.open && other.data.forEach((f) => f(copy)));
    },
    close: () => {
      if (!me.open) return;
      me.open = other.open = false;
      queueMicrotask(() => [...a.close, ...b.close].forEach((f) => f()));
    },
    onData: (f) => me.data.push(f),
    onClose: (f) => me.close.push(f),
  });
  return [end(a, b), end(b, a)];
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('rooms over a network (in-memory transport)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  function setup(mode: 'coop' | 'lps' | 'orbs' = 'lps') {
    const host = new HostRoom('ABCDE', mode, { id: 'host-token-1', name: 'Host', shape: 'star' }, () => 1234);
    const links: Conn[] = [];
    const join = (token: string, name: string) => {
      const client = new ClientRoom(
        async () => {
          const [c, h] = pipe();
          links.push(h);
          host.accept(h);
          return c;
        },
        'ABCDE',
        { token, name, shape: 'diamond' },
        () => 0,
      );
      let view: RoomView = client.view;
      client.subscribe((v) => (view = v));
      return { client, view: () => view };
    };
    return { host, join, links };
  }

  it('lobby → ready → host starts → live snapshots → results → rematch', async () => {
    const { host, join } = setup('lps');
    const a = join('token-aaaa', 'Ana');
    await a.client.open();
    await flush();
    expect(a.view().status).toBe('open');
    expect(a.view().players.map((p) => p.name)).toEqual(['Host', 'Ana']);
    expect(host.canStart()).toBe(false); // Ana is not ready
    a.client.setReady(true);
    await flush();
    expect(host.canStart()).toBe(true);
    expect(host.start()).toBe(true);
    await flush();
    expect(a.view().phase).toBe('playing');

    // Ana pushes right; only the host's simulation moves her, and she sees it in snapshots.
    const startX = host.match!.players[1].x;
    for (let i = 0; i < 30; i++) {
      a.client.input({ x: 1, y: 0 }, 1 / 30);
      await flush();
      host.tick(1 / 30);
    }
    await flush();
    expect(host.match!.players[1].x).toBeGreaterThan(startX + 100);
    const snap = a.client.snaps[a.client.snaps.length - 1].snap;
    expect(snap.players.find((p) => p[0] === 'token-aaaa')![1]).toBeGreaterThan(startX + 100);

    // End the match by eliminating the host; Ana wins.
    host.match!.players[0].alive = false;
    host.match!.players[0].downAt = host.match!.time;
    host.match!.players[0].place = 2;
    host.tick(1 / 60);
    await flush();
    expect(a.view().phase).toBe('results');
    expect(a.view().results!.winners).toEqual(['token-aaaa']);
    host.rematch();
    await flush();
    expect(a.view().phase).toBe('lobby');
    expect(a.view().players.find((p) => p.name === 'Ana')!.ready).toBe(false);
  });

  it('a client cannot move anyone else, and junk messages are ignored', async () => {
    const { host, join, links } = setup('coop');
    const a = join('token-aaaa', 'Ana');
    await a.client.open();
    await flush();
    a.client.setReady(true);
    await flush();
    host.start();
    await flush();
    const hostStart = { x: host.match!.players[0].x, y: host.match!.players[0].y };
    // Raw messages straight down the wire, pretending to be someone else or setting scores.
    const raw = links[0];
    void raw;
    const conn = (a.client as unknown as { conn: Conn }).conn;
    conn.send({ t: 'input', x: 1e9, y: Number.NaN, id: 'host-token-1' });
    conn.send({ t: 'snap', players: [] });
    conn.send({ t: 'end', winners: ['token-aaaa'] });
    conn.send('garbage');
    await flush();
    for (let i = 0; i < 20; i++) host.tick(1 / 60);
    expect(host.match!.players[0].x).toBeCloseTo(hostStart.x, 5);
    expect(host.match!.players[0].y).toBeCloseTo(hostStart.y, 5);
    expect(host.match!.status).toBe('playing');
  });

  it('a dropped player keeps their seat and reconnects into the running match', async () => {
    const { host, join, links } = setup('coop');
    const a = join('token-aaaa', 'Ana');
    await a.client.open();
    await flush();
    a.client.setReady(true);
    await flush();
    host.start();
    await flush();
    links[0].close(); // the network drops
    await flush();
    expect(a.view().status).toBe('reconnecting');
    expect(host.view().players.find((p) => p.name === 'Ana')!.connected).toBe(false);
    await vi.advanceTimersByTimeAsync(2100);
    await flush();
    expect(a.view().status).toBe('open');
    expect(a.view().phase).toBe('playing');
    expect(host.view().players.find((p) => p.name === 'Ana')!.connected).toBe(true);
    expect(host.match!.players.find((p) => p.id === 'token-aaaa')!.connected).toBe(true);
  });

  it('the host leaving closes the room for everyone with a clear message', async () => {
    const { host, join } = setup();
    const a = join('token-aaaa', 'Ana');
    await a.client.open();
    await flush();
    host.close();
    await flush();
    expect(a.view().status).toBe('closed');
    expect(a.view().notice).toMatch(/host left/i);
  });

  it('a player who leaves the lobby frees their seat; late joiners cannot enter a running match', async () => {
    const { host, join } = setup();
    const a = join('token-aaaa', 'Ana');
    await a.client.open();
    await flush();
    a.client.leave();
    await vi.advanceTimersByTimeAsync(300);
    await flush();
    expect(host.view().players.map((p) => p.name)).toEqual(['Host']);

    const b = join('token-bbbb', 'Bo');
    await b.client.open();
    await flush();
    b.client.setReady(true);
    await flush();
    host.start();
    const c = join('token-cccc', 'Cy');
    await c.client.open();
    await flush();
    expect(c.view().status).toBe('closed');
    expect(c.view().notice).toMatch(/already started/);
  });

  it('rooms hold at most six players', async () => {
    const { join } = setup();
    const joined = [];
    for (let i = 0; i < 6; i++) {
      const p = join(`token-${i}xxxxx`, `P${i}`);
      await p.client.open();
      await flush();
      joined.push(p);
    }
    expect(joined.slice(0, 5).every((p) => p.view().status === 'open')).toBe(true);
    expect(joined[5].view().notice).toMatch(/full/);
  });
});
