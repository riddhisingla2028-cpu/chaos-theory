// What the co-op screens show, worked out from room and mission state (pure, so it is unit tested).
// The React components in CoopMatch.tsx and Multiplayer.tsx only lay these out.

import { MP_COLORS } from '../game/render';
import type { ShipId } from '../mission/render';
import { REVIVE_TIME, STRANDED_LIMIT, carrierOf, coopMissionById, type CoopMissionId, type MissionState } from '../mission/sim';
import type { CoopResults } from '../net/coop';
import { OP_MAX_PLAYERS, OP_MIN_PLAYERS, type LobbyPlayer, type RoomView } from '../net/room';

export type RGB = [number, number, number];

export const OP_INFO: Record<CoopMissionId, { name: string; blurb: string }> = {
  'twin-lock': {
    name: 'Co-op Operation · Twin Lock',
    blurb: `Spacecraft co-op for ${OP_MIN_PLAYERS}–${OP_MAX_PLAYERS} pilots: hold two uplinks together, escort the data-core carrier, destroy three generators within seconds of each other, then extract as a squadron. Downed pilots are revived by a teammate who stays close.`,
  },
};

/** Each pilot's hull, by slot (colours come from the player's lobby colour). */
export const COOP_HULLS: ShipId[] = ['arrow', 'interceptor', 'manta', 'arrow'];

export const playerColor = (p: Pick<LobbyPlayer, 'color'> | undefined): RGB => MP_COLORS[(p?.color ?? 0) % MP_COLORS.length];

const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/**
 * Whether the host can start, and if not, why (in plain words). Mirrors HostRoom.canStart, which stays the
 * authority: this only explains it.
 */
export function startState(view: Pick<RoomView, 'players' | 'op' | 'phase'>): { canStart: boolean; reason: string | null } {
  if (view.phase === 'playing') return { canStart: false, reason: 'The match is already running' };
  const connected = view.players.filter((p) => p.connected);
  const reconnecting = view.players.filter((p) => !p.connected);
  if (view.op) {
    if (connected.length < OP_MIN_PLAYERS) return { canStart: false, reason: `Co-op needs ${OP_MIN_PLAYERS}–${OP_MAX_PLAYERS} pilots: waiting for at least ${OP_MIN_PLAYERS - connected.length} more player` };
    if (connected.length > OP_MAX_PLAYERS) return { canStart: false, reason: `Too many for co-op: ${connected.length} players connected, the most is ${OP_MAX_PLAYERS}. Pick an Arcade mode, or someone leaves.` };
  } else if (connected.length < 2) return { canStart: false, reason: 'Waiting for at least one more player' };
  const unready = connected.filter((p) => !p.ready);
  if (unready.length) return { canStart: false, reason: `Waiting for ${list(unready.map((p) => p.name))} to be ready` };
  if (reconnecting.length && view.op) return { canStart: true, reason: `${list(reconnecting.map((p) => p.name))} ${reconnecting.length > 1 ? 'are' : 'is'} reconnecting and will not fly` };
  return { canStart: true, reason: null };
}

export interface PilotRow {
  slot: number;
  id: string;
  name: string;
  color: RGB;
  me: boolean;
  hp: number;
  maxHp: number;
  state: 'flying' | 'downed' | 'offline';
  revive: number; // 0..1
  carrying: boolean;
}

/** The team strip: every pilot, in slot order, with their state. */
export function teamRows(m: MissionState, slots: string[], players: LobbyPlayer[], me: string): PilotRow[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const carrier = carrierOf(m);
  return m.ships.map((s) => {
    const id = slots[s.slot] ?? '';
    const p = byId.get(id);
    return {
      slot: s.slot,
      id,
      name: p?.name ?? `Pilot ${s.slot + 1}`,
      color: playerColor(p),
      me: id === me,
      hp: Math.max(0, s.hp),
      maxHp: m.def.maxHp,
      state: !s.online ? 'offline' : s.downed ? 'downed' : 'flying',
      revive: s.reviveCharge,
      carrying: carrier === s,
    };
  });
}

/** The one thing this pilot most needs to know right now (or null). */
export function coopCallout(m: MissionState, rows: PilotRow[]): { text: string; tone: 'danger' | 'action' | 'info' } | null {
  if (m.status !== 'playing') return null;
  const me = rows.find((r) => r.me);
  if (m.flags.stranded !== undefined) {
    // Nobody online can fly; a disconnected pilot who was still flying could rejoin and revive everyone.
    const left = Math.max(0, Math.ceil(STRANDED_LIMIT - m.flags.stranded));
    const away = rows.filter((r) => r.state === 'offline').map((r) => r.name);
    return { text: `Everyone here is down. Waiting for ${list(away)} to reconnect · ${left}s before the operation fails`, tone: 'danger' };
  }
  if (me?.state === 'downed') return { text: `You are down. A teammate must stay beside your wreck for ${REVIVE_TIME}s to bring you back.`, tone: 'danger' };
  const down = rows.filter((r) => r.state === 'downed');
  if (down.length) {
    const reviving = down.find((r) => r.revive > 0);
    if (reviving) return { text: `Reviving ${reviving.name} · ${Math.round(reviving.revive * 100)}% · stay close!`, tone: 'action' };
    return { text: `${list(down.map((r) => r.name))} ${down.length > 1 ? 'are' : 'is'} down: fly to the wreck and stay inside the circle to revive`, tone: 'danger' };
  }
  const L = m.linked;
  if (L && !L.done && L.firstAt !== null) {
    const left = Math.max(0, L.window - (m.realTime - L.firstAt));
    return { text: `Strike window open · ${left.toFixed(1)}s · bring the rest down together!`, tone: 'danger' };
  }
  if (me?.carrying) return { text: 'You carry the data core: no blaster, slow engines. Stay with your escort.', tone: 'action' };
  const up = m.uplink;
  if (up && !up.active) {
    const held = up.pads.filter((pad) => m.ships.some((p) => p.online && !p.downed && Math.hypot(p.x - pad.x, p.y - pad.y) < pad.r)).length;
    if (held === 1) return { text: 'One uplink held: the other pad needs a pilot at the same time', tone: 'action' };
  }
  const offline = rows.filter((r) => r.state === 'offline');
  if (offline.length) return { text: `${list(offline.map((r) => r.name))} lost connection. Their ship is frozen until they rejoin.`, tone: 'info' };
  return null;
}

export interface ResultsView {
  title: string;
  won: boolean;
  text: string;
  mission: string;
  phases: { title: string; done: boolean }[];
  time: string;
  score: string;
  stars: number;
  rows: { id: string; name: string; color: RGB; me: boolean; kills: number; revives: number; downs: number; objective: string; accuracy: string }[];
}

/** The team debrief: success or failure, which phases were done, and what each pilot did. */
export function resultsView(r: CoopResults, players: LobbyPlayer[], me: string): ResultsView {
  const def = coopMissionById(r.op);
  const byId = new Map(players.map((p) => [p.id, p]));
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return {
    title: r.won ? 'Operation complete' : 'Operation failed',
    won: r.won,
    text: r.won ? `All ${def.phases.length} phases complete` : r.text,
    mission: def.name,
    phases: def.phases.map((p) => ({ title: p.title, done: r.phases.includes(p.title) })),
    time: mmss(r.time),
    score: r.score.toLocaleString(),
    stars: r.stars,
    rows: r.rows.map((x) => ({
      id: x.id,
      name: byId.get(x.id)?.name ?? `Pilot ${x.slot + 1}`,
      color: playerColor(byId.get(x.id)),
      me: x.id === me,
      kills: x.kills,
      revives: x.revives,
      downs: x.downs,
      objective: `${Math.round(x.objectiveTime)}s`,
      accuracy: x.accuracy === null ? '–' : `${x.accuracy}%`,
    })),
  };
}
