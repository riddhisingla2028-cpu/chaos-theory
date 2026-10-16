// The shared multiplayer simulation. Only the HOST runs it: clients send their stick input and
// receive snapshots, so no client can decide its own (or anyone else's) position, score or result.
// Pure and deterministic for a given seed and input sequence, so it is unit tested like the engine.

import { ARENAS, bounceHazard, resolveBody, rotorHits, standable, type ArenaDef } from '../game/arenas';

export type MatchMode = 'coop' | 'lps' | 'orbs';

export interface MatchModeDef {
  id: MatchMode;
  name: string;
  blurb: string;
  arena: ArenaDef;
  duration: number; // seconds; 0 = until decided
}

export const MATCH_MODES: readonly MatchModeDef[] = [
  { id: 'coop', name: 'Co-op Survival', blurb: 'Survive together for 2 minutes. Downed players return after 5s while anyone is still standing.', arena: ARENAS.grid, duration: 120 },
  { id: 'lps', name: 'Last Player Standing', blurb: 'One hit and you are out. Shared hazards, a sweeping rotor, one winner.', arena: ARENAS.ring, duration: 0 },
  { id: 'orbs', name: 'Orb Race', blurb: 'Most orbs in 60 seconds wins. A hit costs you an orb and a moment.', arena: ARENAS.maze, duration: 60 },
];

export const matchMode = (id: MatchMode) => MATCH_MODES.find((m) => m.id === id) ?? MATCH_MODES[0];

export const MAX_PLAYERS = 6;
export const MP_PLAYER_SPEED = 360;
export const MP_PLAYER_R = 10;
const RESPAWN = 5;
const STUN = 2;
const GRACE = 2; // seconds of invulnerability after (re)spawning

export interface MatchPlayer {
  id: string;
  name: string;
  shape: string;
  color: number; // index into the player palette
  x: number;
  y: number;
  vx: number;
  vy: number;
  alive: boolean;
  connected: boolean;
  downAt: number | null; // when they were hit (co-op downs, LPS eliminations, orb-race stuns)
  graceUntil: number;
  orbs: number;
  aliveTime: number;
  hits: number;
  place: number | null; // LPS finishing place
}

export interface MatchHazard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  seek: boolean;
}

export interface Match {
  mode: MatchMode;
  seed: number;
  rng: () => number;
  time: number;
  status: 'playing' | 'over';
  players: MatchPlayer[];
  hazards: MatchHazard[];
  orbs: { x: number; y: number }[];
  spawnTimer: number;
  outcome: MatchOutcome | null;
}

export interface MatchOutcome {
  winners: string[]; // player ids; empty for a team loss
  team: boolean; // co-op: everyone shares the result
  won: boolean; // co-op only: did the team survive
  text: string;
}

export interface Vec {
  x: number;
  y: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createMatch(seed: number, mode: MatchMode, roster: { id: string; name: string; shape: string; color: number }[]): Match {
  const def = matchMode(mode);
  const a = def.arena;
  const players = roster.slice(0, MAX_PLAYERS).map((p, i, all): MatchPlayer => {
    const ang = (i / all.length) * Math.PI * 2 - Math.PI / 2;
    const spot = { x: a.spawn.x + Math.cos(ang) * (all.length > 1 ? 70 : 0), y: a.spawn.y + Math.sin(ang) * (all.length > 1 ? 70 : 0) };
    resolveBody(a, 0, spot, MP_PLAYER_R);
    return { ...p, ...spot, vx: 0, vy: 0, alive: true, connected: true, downAt: null, graceUntil: GRACE, orbs: 0, aliveTime: 0, hits: 0, place: null };
  });
  const m: Match = { mode, seed, rng: mulberry32(seed), time: 0, status: 'playing', players, hazards: [], orbs: [], spawnTimer: 1.5, outcome: null };
  if (mode === 'orbs') for (let i = 0; i < 3; i++) placeOrb(m);
  return m;
}

/** How hard the match is right now: spawn interval and hazard speed. Ramps over ~90s. */
function pressure(m: Match): { interval: number; speed: number } {
  const k = Math.min(1, m.time / 90);
  const crowd = 1 + 0.12 * (m.players.length - 1); // a little more pressure with more players
  const base = m.mode === 'lps' ? 0.95 : m.mode === 'orbs' ? 1.2 : 1.05;
  return { interval: (base - 0.6 * k) / crowd, speed: 170 + 150 * k };
}

function placeOrb(m: Match): void {
  const a = matchMode(m.mode).arena;
  for (let tries = 0; tries < 60; tries++) {
    const x = 60 + m.rng() * 880;
    const y = 60 + m.rng() * 880;
    if (!standable(a, m.time, x, y, 18)) continue;
    if (m.players.some((p) => Math.hypot(p.x - x, p.y - y) < 160)) continue;
    m.orbs.push({ x, y });
    return;
  }
}

function spawnHazard(m: Match): void {
  const a = matchMode(m.mode).arena;
  const b = a.bounds;
  const side = Math.floor(m.rng() * 4);
  const along = m.rng();
  const x = side === 1 ? b.x + b.w + 10 : side === 3 ? b.x - 10 : b.x + along * b.w;
  const y = side === 2 ? b.y + b.h + 10 : side === 0 ? b.y - 10 : b.y + along * b.h;
  const targets = m.players.filter((p) => p.alive && p.connected);
  const t = targets.length ? targets[Math.floor(m.rng() * targets.length)] : { x: 500, y: 500 };
  const ang = Math.atan2(t.y - y, t.x - x) + (m.rng() - 0.5) * 0.7;
  const { speed } = pressure(m);
  const seek = m.mode === 'lps' && m.time > 30 && m.rng() < 0.2;
  const v = seek ? speed * 0.55 : speed * (0.85 + m.rng() * 0.3);
  m.hazards.push({ x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, r: seek ? 13 : 9 + m.rng() * 4, seek });
}

const hit = (p: MatchPlayer, m: Match) => p.alive && p.connected && m.time >= p.graceUntil;

/** Advance the match. `inputs` maps player id to a stick vector (clamped to length 1 here). */
export function stepMatch(m: Match, inputs: Record<string, Vec>, dt: number): void {
  if (m.status !== 'playing') return;
  m.time += dt;
  const def = matchMode(m.mode);
  const a = def.arena;

  for (const p of m.players) {
    // Downed players come back (co-op) or recover from a stun (orb race).
    if (!p.alive && p.downAt !== null && p.connected) {
      const back = m.mode === 'coop' ? RESPAWN : m.mode === 'orbs' ? STUN : Infinity;
      const someoneUp = m.players.some((o) => o.alive && o.connected);
      if (m.time - p.downAt >= back && (m.mode !== 'coop' || someoneUp)) {
        p.alive = true;
        p.downAt = null;
        p.graceUntil = m.time + GRACE;
        p.x = a.spawn.x;
        p.y = a.spawn.y;
      }
    }
    if (!p.alive || !p.connected) {
      p.vx = p.vy = 0;
      continue;
    }
    p.aliveTime += dt;
    const raw = inputs[p.id] ?? { x: 0, y: 0 };
    const len = Math.hypot(raw.x || 0, raw.y || 0);
    const ix = len > 1 ? raw.x / len : raw.x || 0;
    const iy = len > 1 ? raw.y / len : raw.y || 0;
    const k = Math.min(1, dt * 14);
    p.vx += (ix * MP_PLAYER_SPEED - p.vx) * k;
    p.vy += (iy * MP_PLAYER_SPEED - p.vy) * k;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    resolveBody(a, m.time, p, MP_PLAYER_R);
  }

  // Hazards
  m.spawnTimer -= dt;
  if (m.spawnTimer <= 0 && m.hazards.length < 40) {
    spawnHazard(m);
    m.spawnTimer = pressure(m).interval;
  }
  for (const h of m.hazards) {
    if (h.seek) {
      const target = m.players.filter((p) => p.alive && p.connected).sort((p, q) => Math.hypot(p.x - h.x, p.y - h.y) - Math.hypot(q.x - h.x, q.y - h.y))[0];
      if (target) {
        const sp = Math.hypot(h.vx, h.vy);
        const ang = Math.atan2(target.y - h.y, target.x - h.x);
        h.vx += (Math.cos(ang) * sp - h.vx) * Math.min(1, dt * 1.2);
        h.vy += (Math.sin(ang) * sp - h.vy) * Math.min(1, dt * 1.2);
      }
    }
    h.x += h.vx * dt;
    h.y += h.vy * dt;
    bounceHazard(a, m.time, h);
  }
  m.hazards = m.hazards.filter((h) => h.x > -60 && h.x < 1060 && h.y > -60 && h.y < 1060);

  // Collisions
  for (const p of m.players) {
    if (!hit(p, m)) continue;
    const struck = m.hazards.some((h) => Math.hypot(h.x - p.x, h.y - p.y) < h.r + MP_PLAYER_R) || a.rotors.some((r) => rotorHits(r, m.time, p.x, p.y, MP_PLAYER_R));
    if (!struck) continue;
    p.hits++;
    p.alive = false;
    p.downAt = m.time;
    if (m.mode === 'orbs' && p.orbs > 0) p.orbs--;
    if (m.mode === 'lps') p.place = m.players.filter((o) => o.alive && o.connected).length + 1;
  }

  // Orbs
  if (m.mode === 'orbs') {
    for (const p of m.players) {
      if (!p.alive || !p.connected) continue;
      const i = m.orbs.findIndex((o) => Math.hypot(o.x - p.x, o.y - p.y) < MP_PLAYER_R + 14);
      if (i >= 0) {
        m.orbs.splice(i, 1);
        p.orbs++;
        placeOrb(m);
      }
    }
  }

  decide(m);
}

/** Mark a player as gone (left or dropped). In LPS that is an elimination. */
export function setConnected(m: Match, id: string, connected: boolean): void {
  const p = m.players.find((q) => q.id === id);
  if (!p) return;
  p.connected = connected;
  if (!connected && m.mode === 'lps' && p.alive) {
    p.alive = false;
    p.downAt = m.time;
    p.place = m.players.filter((o) => o.alive && o.connected).length + 1;
  }
  if (connected && m.mode !== 'lps' && !p.alive && p.downAt === null) p.downAt = m.time; // returns via the normal respawn
  decide(m);
}

function decide(m: Match): void {
  if (m.status !== 'playing') return;
  const def = matchMode(m.mode);
  const present = m.players.filter((p) => p.connected);
  const standing = present.filter((p) => p.alive);
  const finish = (o: MatchOutcome) => {
    m.status = 'over';
    m.outcome = o;
  };
  if (present.length === 0) return finish({ winners: [], team: m.mode === 'coop', won: false, text: 'Everyone left' });
  if (m.mode === 'coop') {
    if (standing.length === 0) return finish({ winners: [], team: true, won: false, text: `The team fell after ${m.time.toFixed(1)}s` });
    if (m.time >= def.duration) return finish({ winners: present.map((p) => p.id), team: true, won: true, text: 'The team survived!' });
  } else if (m.mode === 'lps') {
    if (standing.length <= 1 && m.players.length > 1) {
      if (standing.length === 1) {
        standing[0].place = 1;
        return finish({ winners: [standing[0].id], team: false, won: true, text: `${standing[0].name} is the last one standing` });
      }
      return finish({ winners: [], team: false, won: false, text: 'Nobody survived: a draw' });
    }
    if (m.players.length === 1 && standing.length === 0) return finish({ winners: [], team: false, won: false, text: 'Eliminated' });
  } else if (m.time >= def.duration) {
    const top = Math.max(...present.map((p) => p.orbs));
    const winners = present.filter((p) => p.orbs === top).map((p) => p.id);
    const names = present.filter((p) => winners.includes(p.id)).map((p) => p.name);
    return finish({ winners, team: false, won: true, text: winners.length > 1 ? `A tie at ${top} orbs: ${names.join(' and ')}` : `${names[0]} wins with ${top} orbs` });
  }
}

/** Final standings, best first. */
export function standings(m: Match): MatchPlayer[] {
  const ps = [...m.players];
  if (m.mode === 'orbs') return ps.sort((a, b) => b.orbs - a.orbs || a.hits - b.hits);
  if (m.mode === 'lps') return ps.sort((a, b) => (a.place ?? 99) - (b.place ?? 99) || b.aliveTime - a.aliveTime);
  return ps.sort((a, b) => b.aliveTime - a.aliveTime);
}

// ---------- Snapshots (what the host sends 20 times a second) ----------

export interface Snapshot {
  t: 'snap';
  time: number;
  status: Match['status'];
  players: [string, number, number, 0 | 1, 0 | 1, number, number, number, number][]; // id, x, y, alive, connected, orbs, aliveTime, hits, grace-left
  hazards: [number, number, number, 0 | 1][]; // x, y, r, seek
  orbs: [number, number][];
  outcome: MatchOutcome | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function snapshot(m: Match): Snapshot {
  return {
    t: 'snap',
    time: r1(m.time),
    status: m.status,
    players: m.players.map((p) => [p.id, r1(p.x), r1(p.y), p.alive ? 1 : 0, p.connected ? 1 : 0, p.orbs, r1(p.aliveTime), p.hits, r1(Math.max(0, p.graceUntil - m.time))]),
    hazards: m.hazards.map((h) => [r1(h.x), r1(h.y), r1(h.r), h.seek ? 1 : 0]),
    orbs: m.orbs.map((o) => [r1(o.x), r1(o.y)]),
    outcome: m.outcome,
  };
}
