import { describe, expect, it } from 'vitest';
import { MP_COLORS } from '../game/render';
import { REVIVE_TIME, STRANDED_LIMIT, createMission, coopMissionById } from '../mission/sim';
import { coopResults, createCoopMatch, stepCoop, type NetInput } from '../net/coop';
import { HostRoom, type LobbyPlayer, type RoomView } from '../net/room';
import { coopSquad } from '../mission/testkit';
import { coopCallout, resultsView, startState, teamRows } from './coopView';

const player = (i: number, over: Partial<LobbyPlayer> = {}): LobbyPlayer => ({ id: `p${i}`, name: `P${i}`, shape: 'square', color: i, ready: true, connected: true, host: i === 0, ...over });
const view = (players: LobbyPlayer[], op: RoomView['op'], phase: RoomView['phase'] = 'lobby') => ({ players, op, phase });

describe('the lobby explains why Start is unavailable', () => {
  it('co-op: needs 2-4 connected players, all ready', () => {
    expect(startState(view([player(0)], 'twin-lock'))).toMatchObject({ canStart: false, reason: expect.stringMatching(/needs 2–4 pilots/) });
    expect(startState(view([player(0), player(1, { ready: false })], 'twin-lock'))).toMatchObject({ canStart: false, reason: 'Waiting for P1 to be ready' });
    expect(startState(view([player(0), player(1, { ready: false }), player(2, { ready: false })], 'twin-lock')).reason).toBe('Waiting for P1 and P2 to be ready');
    expect(startState(view([0, 1, 2, 3, 4].map((i) => player(i)), 'twin-lock'))).toMatchObject({ canStart: false, reason: expect.stringMatching(/Too many for co-op: 5/) });
    expect(startState(view([player(0), player(1)], 'twin-lock'))).toEqual({ canStart: true, reason: null });
    expect(startState(view([0, 1, 2, 3].map((i) => player(i)), 'twin-lock'))).toEqual({ canStart: true, reason: null });
    // Someone reconnecting does not count, and the host is told they will not fly.
    expect(startState(view([player(0), player(1), player(2, { connected: false })], 'twin-lock'))).toMatchObject({ canStart: true, reason: expect.stringMatching(/P2 is reconnecting/) });
  });

  it('Arcade: two or more, all ready (unchanged), up to the room size', () => {
    expect(startState(view([player(0)], null)).reason).toBe('Waiting for at least one more player');
    expect(startState(view([0, 1, 2, 3, 4, 5].map((i) => player(i)), null))).toEqual({ canStart: true, reason: null });
  });

  it('always agrees with the host’s own rule (HostRoom.canStart)', () => {
    for (let n = 1; n <= 6; n++) {
      for (const op of [null, 'twin-lock'] as const) {
        for (let unready = 0; unready <= Math.min(2, n - 1); unready++) {
          for (let gone = 0; gone <= Math.min(1, n - 1); gone++) {
            const host = new HostRoom('ABCDE', 'coop', { id: 'host-token-01', name: 'Host', shape: 'star' });
            // Fill the seats the way the room does (via its private table: this test only reads canStart).
            const seats = (host as unknown as { seats: Map<string, { player: LobbyPlayer }> }).seats;
            for (let i = 1; i < n; i++) seats.set(`p${i}`, { player: player(i, { ready: i > unready, connected: i <= n - 1 - gone || gone === 0 }) } as never);
            host.setOperation(op);
            const v = host.view();
            expect(startState(v).canStart, `${n} players, ${unready} unready, ${gone} gone, ${op}`).toBe(host.canStart());
          }
        }
      }
    }
  });
});

describe('the co-op HUD', () => {
  const slots = ['p0', 'p1', 'p2'];
  const players = [player(0, { name: 'Ana' }), player(1, { name: 'Bo' }), player(2, { name: 'Cy' })];

  it('lists every pilot with their colour, hull and state; marks you', () => {
    const m = createMission(coopMissionById('twin-lock'), 1, 3);
    m.ships[1].downed = true;
    m.ships[1].reviveCharge = 0.4;
    m.ships[2].online = false;
    const rows = teamRows(m, slots, players, 'p0');
    expect(rows.map((r) => [r.name, r.state, r.me])).toEqual([
      ['Ana', 'flying', true],
      ['Bo', 'downed', false],
      ['Cy', 'offline', false],
    ]);
    expect(rows[1].revive).toBe(0.4);
    expect(rows[2].color).toEqual(MP_COLORS[2]);
    expect(rows[0].hp).toBe(m.def.maxHp);
  });

  it('calls out what matters most: you down, then a teammate to revive, then the strike window, then the core', () => {
    const m = createMission(coopMissionById('twin-lock'), 1, 3);
    const rows = () => teamRows(m, slots, players, 'p0');
    expect(coopCallout(m, rows())).toBeNull();
    m.ships[1].downed = true;
    expect(coopCallout(m, rows())).toMatchObject({ tone: 'danger', text: expect.stringMatching(/Bo is down: fly to the wreck/) });
    m.ships[1].reviveCharge = 0.5;
    expect(coopCallout(m, rows())!.text).toMatch(/Reviving Bo · 50%/);
    m.ships[0].downed = true;
    expect(coopCallout(m, rows())!.text).toBe(`You are down. A teammate must stay beside your wreck for ${REVIVE_TIME}s to bring you back.`);
    m.ships[0].downed = false;
    m.ships[1].downed = false;
    m.pods.push({ id: 900, x: m.ships[0].x, y: m.ships[0].y + 30, vx: 0, vy: 0, state: 'towed', found: true, heavy: true, towedBy: 0 });
    expect(coopCallout(m, rows())!.text).toMatch(/You carry the data core/);
    m.linked = { tag: 'sync', kind: 'generator', spots: [], hp: 10, regen: 4, window: 3, range: 200, firstAt: m.realTime - 1, done: false };
    expect(coopCallout(m, rows())!.text).toMatch(/Strike window open · 2\.0s/);
    m.status = 'won';
    expect(coopCallout(m, rows())).toBeNull();
  });

  it('while the squadron waits for a disconnected pilot, says who and how long is left (above everything else)', () => {
    const m = createMission(coopMissionById('twin-lock'), 1, 3);
    m.ships[0].downed = true;
    m.ships[1].downed = true;
    m.ships[2].online = false;
    m.flags.stranded = 12.2;
    const c = coopCallout(m, teamRows(m, slots, players, 'p0'));
    expect(c).toMatchObject({ tone: 'danger', text: `Everyone here is down. Waiting for Cy to reconnect · ${STRANDED_LIMIT - 12}s before the operation fails` });
  });

  it('notices one uplink held alone', () => {
    const m = createMission(coopMissionById('twin-lock'), 1, 2);
    const pad = m.uplink!.pads[0];
    m.ships[0].x = pad.x;
    m.ships[0].y = pad.y;
    expect(coopCallout(m, teamRows(m, ['p0', 'p1'], players, 'p0'))!.text).toMatch(/other pad needs a pilot/);
  });
});

describe('the team debrief', () => {
  it('shows success, phases, time, score and each pilot’s kills, revives and times downed, by name', () => {
    const c = createCoopMatch('twin-lock', 3, ['p0', 'p1']);
    while (c.mission.status === 'playing' && c.mission.realTime < 300) {
      for (const p of c.mission.ships) p.invuln = 5;
      const inp = coopSquad(c.mission);
      stepCoop(c, { p0: inp[0] as NetInput, p1: inp[1] as NetInput }, 1 / 60);
    }
    const v = resultsView(coopResults(c), [player(0, { name: 'Ana' }), player(1, { name: 'Bo' })], 'p1');
    expect(v.title).toBe('Operation complete');
    expect(v.phases.every((p) => p.done)).toBe(true);
    expect(v.time).toMatch(/^\d+:\d\d$/);
    expect(v.rows.map((r) => [r.name, r.me])).toEqual([
      ['Ana', false],
      ['Bo', true],
    ]);
    expect(v.rows.reduce((k, r) => k + r.kills, 0)).toBe(c.mission.kills);
    expect(v.rows.every((r) => typeof r.revives === 'number' && typeof r.downs === 'number')).toBe(true);
  });

  it('a failed operation shows which phases were not done', () => {
    const c = createCoopMatch('twin-lock', 3, ['p0', 'p1']);
    c.mission.status = 'lost';
    c.mission.failReason = 'The whole squadron is down · Shot down';
    c.mission.phasesDone = ['Lock both uplinks'];
    const v = resultsView(coopResults(c), [player(0), player(1)], 'p0');
    expect(v.title).toBe('Operation failed');
    expect(v.phases.map((p) => p.done)).toEqual([true, false, false, false]);
    expect(v.text).toMatch(/squadron is down/);
  });
});
