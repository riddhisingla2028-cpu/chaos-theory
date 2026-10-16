// A simple AI pilot. It plays the animated level previews and is used to balance-test levels.
// It is deliberately imperfect: it re-decides only every `reaction` seconds and needs time
// to adjust to inverted controls, roughly like an attentive beginner.

import {
  ARENA,
  VOID_TILE,
  arenaTime,
  chaosHas,
  inVoid,
  shrinkInset,
  type GameState,
  type Vec,
} from './engine';
import { OPEN_ARENA, rotorAngle, rotorArmed, standable, type ArenaDef } from './arenas';

const CELL = 25;
const N = ARENA / CELL;

/** Breadth-first search over a walkable grid. Returns the path of cell indices (excluding the start). */
function bfs(ok: (i: number) => boolean, start: number, isGoal: (i: number) => boolean): number[] | null {
  const prev = new Int32Array(N * N).fill(-2);
  prev[start] = -1;
  const queue = [start];
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q];
    if (cur !== start && isGoal(cur)) {
      const path: number[] = [];
      for (let c = cur; c !== start; c = prev[c]) path.push(c);
      return path.reverse();
    }
    const cx = cur % N;
    const cy = (cur / N) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const ni = ny * N + nx;
      if (prev[ni] !== -2 || !ok(ni)) continue;
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  return null;
}

/** Every cell reachable from start through walkable cells. */
function bfsAll(ok: (i: number) => boolean, start: number): number[] {
  const seen = new Uint8Array(N * N);
  seen[start] = 1;
  const queue = [start];
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q];
    const cx = cur % N;
    const cy = (cur / N) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const ni = ny * N + nx;
      if (seen[ni] || !ok(ni)) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  return queue;
}

const cellOf = (x: number, y: number) => Math.min(N - 1, Math.max(0, (y / CELL) | 0)) * N + Math.min(N - 1, Math.max(0, (x / CELL) | 0));
const centre = (i: number) => ({ x: (i % N) * CELL + CELL / 2, y: ((i / N) | 0) * CELL + CELL / 2 });
const hasGeometry = (a: ArenaDef) => a !== OPEN_ARENA && (a.walls.length > 0 || a.floor !== null || !!a.circle || a.rotors.length > 0 || a.bounds.w < ARENA);

export interface AutopilotOptions {
  reaction?: number; // seconds between decisions
  invertDelay?: number; // seconds before compensating for INVERSION
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function createAutopilot(opts: AutopilotOptions = {}): (g: GameState) => Vec {
  const reaction = opts.reaction ?? 0.15;
  const invertDelay = opts.invertDelay ?? 0.5;
  let next = -1;
  let input: Vec = { x: 0, y: 0 };
  let invertSince: number | null = null;

  return (g) => {
    if (g.time < next) return input;
    next = g.time + reaction;
    const p = g.player;
    let x = 0;
    let y = 0;
    const push = (dx: number, dy: number, w: number) => {
      const d = Math.hypot(dx, dy) || 1;
      x += (dx / d) * w;
      y += (dy / d) * w;
    };

    // Dodge nearby hazards, sidestepping across their path.
    for (const h of g.hazards) {
      const hx = h.blink && h.blink.t < 0.25 ? h.blink.x : h.x;
      const hy = h.blink && h.blink.t < 0.25 ? h.blink.y : h.y;
      const dx = p.x - hx;
      const dy = p.y - hy;
      const d = Math.hypot(dx, dy) || 1;
      if (d > 170) continue;
      const w = (170 - d) / 170;
      push(dx, dy, w * 2);
      const sp = Math.hypot(h.vx, h.vy) || 1;
      const side = Math.sign(-h.vy * dx + h.vx * dy) || 1;
      x += (-h.vy / sp) * side * w;
      y += (h.vx / sp) * side * w;
    }

    // Chase the nearest orb, or drift back towards the middle.
    const cost = (o: (typeof g.orbs)[number]) => Math.hypot(o.x - p.x, o.y - p.y) * (o.bonus ? 0.6 : 1);
    const orb = g.orbs.reduce<(typeof g.orbs)[number] | null>((best, o) => (!best || cost(o) < cost(best) ? o : best), null);
    const arena = g.config.arena;
    const at = arenaTime(g);
    const geo = hasGeometry(arena);
    let escaping = false;
    if (geo) {
      // Navigate the geometry: walkable = standable now and for the next ~1.4s.
      // Two tiers: cells safe to pass through soon, and cells safe to stay on for a few seconds.
      const memo = (lookahead: number, pad: number) => {
        const cache = new Int8Array(N * N);
        return (i: number) => {
          if (cache[i] === 0) {
            const c = centre(i);
            cache[i] = standable(arena, at, c.x, c.y, pad, lookahead) ? 1 : -1;
          }
          return cache[i] === 1;
        };
      };
      const pass = memo(0.9, 14);
      const ok = memo(3, 15);
      const start = cellOf(p.x, p.y);
      let path: number[] | null = null;
      let urgent = false;
      if (!ok(start)) {
        // Standing somewhere that will soon be gone: get to floor that will last.
        // Cross only floor that will last the trip (~0.6s), except the cell we are already on.
        const soon = memo(0.6, 12);
        path = bfs((i) => pass(i) || soon(i), start, ok);
        urgent = true;
        escaping = true;
      } else if (orb) {
        const goal = cellOf(orb.x, orb.y);
        path = bfs(pass, start, (i) => i === goal);
        if (!path) {
          // No route right now (bridges up elsewhere): stage at the safe spot nearest the orb and wait.
          const reach = bfsAll(pass, start);
          let best = -1;
          let bestD = Infinity;
          for (const i of reach) {
            if (!ok(i)) continue;
            const c = centre(i);
            const d = Math.hypot(c.x - orb.x, c.y - orb.y);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
          const here = Math.hypot(p.x - orb.x, p.y - orb.y);
          if (best >= 0 && bestD < here - 30) path = bfs(pass, start, (i) => i === best);
        }
      } else {
        // No target: drift towards the most open nearby floor (cells with many walkable neighbours).
        const roomy = (i: number) => {
          const cx = i % N;
          const cy = (i / N) | 0;
          let n = 0;
          for (let dy = -3; dy <= 3; dy += 3) for (let dx = -3; dx <= 3; dx += 3) if (cx + dx >= 0 && cy + dy >= 0 && cx + dx < N && cy + dy < N && ok((cy + dy) * N + cx + dx)) n++;
          return n >= 9;
        };
        if (!roomy(start)) path = bfs(ok, start, roomy);
      }
      if (path && path.length > 0) {
        const wp = centre(path[Math.min(path.length - 1, 3)]);
        push(wp.x - p.x, wp.y - p.y, urgent ? 3.5 : 1.6);
      }
    } else if (orb) push(orb.x - p.x, orb.y - p.y, 1.3);
    else push(ARENA / 2 - p.x, ARENA / 2 - p.y, Math.min(1, Math.hypot(ARENA / 2 - p.x, ARENA / 2 - p.y) / 400) * 0.6);

    // Rotor arms: run ahead of them like boss beams.
    for (const rot of arena.rotors) {
      if (!rotorArmed(rot, at - 0.6)) continue;
      const dx = p.x - rot.cx;
      const dy = p.y - rot.cy;
      const d = Math.hypot(dx, dy) || 1;
      const theta = Math.atan2(dy, dx);
      const spin = Math.sign(rot.speed) || 1;
      for (let i = 0; i < rot.arms; i++) {
        const behind = wrap(theta - rotorAngle(rot, at, i)) * spin;
        if (behind > -0.15 && behind < 1.4) {
          x += (-dy / d) * spin * 2.6;
          y += (dx / d) * spin * 2.6;
        }
      }
    }

    // Keep clear of closing walls.
    const c = g.chaos;
    const wall = Math.max(g.inset, shrinkInset(g), chaosHas(c, 'COLLAPSE') ? 240 : 0) + 70;
    if (p.x < wall) x += (wall - p.x) / 40;
    if (p.x > ARENA - wall) x -= (p.x - (ARENA - wall)) / 40;
    if (p.y < wall) y += (wall - p.y) / 40;
    if (p.y > ARENA - wall) y -= (p.y - (ARENA - wall)) / 40;

    // Step off tiles that are about to vanish.
    for (const v of g.voids) {
      if (!inVoid(v, p.x, p.y, -24)) continue;
      const cx = (v.ix + 0.5) * VOID_TILE;
      const cy = (v.iy + 0.5) * VOID_TILE;
      push(p.x - cx, p.y - cy, 3);
    }

    if (c?.zone && chaosHas(c, 'HORIZON')) push(c.zone.x - p.x, c.zone.y - p.y, 2.5 * Math.min(1, Math.hypot(c.zone.x - p.x, c.zone.y - p.y) / 150));
    if (c && chaosHas(c, 'GRAVITY') && c.phase === 'active') {
      x -= c.gravity.x * 0.8;
      y -= c.gravity.y * 0.8;
    }
    if (c && chaosHas(c, 'AFTERIMAGE')) {
      // Circle widely so the trail is never re-crossed.
      const cx = ARENA / 2 - p.x;
      const cy = ARENA / 2 - p.y;
      const r = Math.hypot(cx, cy) || 1;
      const radial = r < 200 ? -0.8 : r > 320 ? 0.8 : 0;
      x += (-cy / r) * 1.6 + (cx / r) * radial;
      y += (cx / r) * 1.6 + (cy / r) * radial;
    }
    for (const sw of g.sweeps) {
      if (sw.axis === 'x') y += Math.sign(sw.gap - p.y) * 1.5;
      else x += Math.sign(sw.gap - p.x) * 1.5;
    }

    // Boss: keep distance, run ahead of beams, head for the gap in bursts.
    const b = g.boss;
    if (b && b.hp > 0) {
      const dx = p.x - b.x;
      const dy = p.y - b.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < b.r + 130) push(dx, dy, 2.5);
      const a = b.attack;
      if (a?.kind === 'beam' || a?.kind === 'twin') {
        const theta = Math.atan2(dy, dx);
        for (const angle of a.kind === 'twin' ? [a.angle, a.angle + Math.PI] : [a.angle]) {
          const behind = wrap(theta - angle) * a.spin; // > 0: a beam is coming round towards us
          if (behind > -0.2 && behind < 1.8) {
            x += (-dy / d) * a.spin * 2.5;
            y += (dx / d) * a.spin * 2.5;
            if (d > 260) push(-dx, -dy, 0.8); // tighter circles are quicker to run
          }
        }
      } else if (a?.kind === 'nova' && a.radius < d + 40) {
        // Line up with the gap in the shockwave before it reaches us.
        const tx = b.x + Math.cos(a.angle) * d;
        const ty = b.y + Math.sin(a.angle) * d;
        push(tx - p.x, ty - p.y, 3 * Math.min(1, Math.hypot(tx - p.x, ty - p.y) / 60));
      } else if (a?.kind === 'burst' && a.phase === 'tell') {
        const gapAngle = a.angle + (1.5 / 16) * Math.PI * 2;
        push(b.x + Math.cos(gapAngle) * 280 - p.x, b.y + Math.sin(gapAngle) * 280 - p.y, 1.6);
      }
    }

    const m = Math.hypot(x, y);
    input = m > 0.15 ? { x: x / m, y: y / m } : { x: 0, y: 0 };
    if (geo && (input.x !== 0 || input.y !== 0)) {
      // Never choose a direction that walks off the floor or into a wall; try nearby angles instead.
      // When escaping doomed floor, floor that is solid right now is good enough to run across.
      const look = escaping ? 0.3 : 0.4;
      const safe = (dx: number, dy: number) =>
        standable(arena, at, p.x + dx * 30, p.y + dy * 30, 11, look) && standable(arena, at, p.x + dx * 55, p.y + dy * 55, 11, look * 1.5);
      if (!safe(input.x, input.y)) {
        const base = Math.atan2(input.y, input.x);
        let found: Vec | null = null;
        for (const off of [0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.2, -2.2, Math.PI]) {
          const a2 = base + off;
          if (safe(Math.cos(a2), Math.sin(a2))) {
            found = { x: Math.cos(a2), y: Math.sin(a2) };
            break;
          }
        }
        input = found ?? { x: 0, y: 0 };
      }
    }
    if (c && chaosHas(c, 'INVERSION') && c.phase === 'active') {
      invertSince ??= g.time;
      if (g.time - invertSince > invertDelay) input = { x: -input.x, y: -input.y };
    } else invertSince = null;
    return input;
  };
}
