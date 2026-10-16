// A simple AI pilot. It plays the animated level previews and is used to balance-test levels.
// It is deliberately imperfect: it re-decides only every `reaction` seconds and needs time
// to adjust to inverted controls, roughly like an attentive beginner.

import {
  ARENA,
  VOID_TILE,
  chaosHas,
  inVoid,
  shrinkInset,
  type GameState,
  type Vec,
} from './engine';

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
    const orb = g.orbs.reduce<(typeof g.orbs)[number] | null>(
      (best, o) => (!best || Math.hypot(o.x - p.x, o.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y) ? o : best),
      null,
    );
    if (orb) push(orb.x - p.x, orb.y - p.y, 1.3);
    else push(ARENA / 2 - p.x, ARENA / 2 - p.y, Math.min(1, Math.hypot(ARENA / 2 - p.x, ARENA / 2 - p.y) / 400) * 0.6);

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
      if (a?.kind === 'beam') {
        const theta = Math.atan2(dy, dx);
        const behind = wrap(theta - a.angle) * a.spin; // > 0: beam is coming round towards us
        if (behind > -0.2 && behind < 1.8) {
          x += (-dy / d) * a.spin * 2.5;
          y += (dx / d) * a.spin * 2.5;
          if (d > 260) push(-dx, -dy, 0.8); // tighter circles are quicker to run
        }
      } else if (a?.kind === 'burst' && a.phase === 'tell') {
        const gapAngle = a.angle + (1.5 / 16) * Math.PI * 2;
        push(b.x + Math.cos(gapAngle) * 280 - p.x, b.y + Math.sin(gapAngle) * 280 - p.y, 1.6);
      }
    }

    const m = Math.hypot(x, y);
    input = m > 0.15 ? { x: x / m, y: y / m } : { x: 0, y: 0 };
    if (c && chaosHas(c, 'INVERSION') && c.phase === 'active') {
      invertSince ??= g.time;
      if (g.time - invertSince > invertDelay) input = { x: -input.x, y: -input.y };
    } else invertSince = null;
    return input;
  };
}
