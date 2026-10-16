// Arena geometry: reusable definitions for every level's playable space.
//
// An arena is built from four primitives:
//   - bounds:  the playable rectangle (hazards enter from its edges); may be narrow (The Gauntlet)
//   - circle:  an optional circular boundary inside the bounds (The Ring, the boss arena)
//   - walls:   solid blocks the player is pushed out of and hazards bounce off; may slide back and forth
//   - floor:   where the player can stand. Null means "everywhere inside the boundary". Floor pieces
//              can appear, vanish (after a warning) or cycle like drawbridges. Off the floor is a fall.
//   - rotors:  arms sweeping around a centre
// All times are seconds since the arena became active, so a boss phase can swap in new geometry.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Wall extends Rect {
  /** Slides between its position and (x+dx, y+dy) and back over `period` seconds. */
  move?: { dx: number; dy: number; period: number; phase?: number };
}

export interface FloorPiece extends Rect {
  from?: number; // appears at this time (before that it is not floor)
  until?: number; // vanishes at this time (warned beforehand)
  /** Drawbridge: solid for `on` seconds out of every `period`, starting `offset` seconds in. */
  cycle?: { period: number; on: number; offset: number };
  warn?: number; // seconds of warning before it goes (default FLOOR_WARNING); longer for big platforms
}

export interface Rotor {
  cx: number;
  cy: number;
  length: number;
  half: number; // half thickness
  speed: number; // radians per second (negative = anticlockwise)
  arms: number;
  angle: number; // starting angle
  from?: number; // becomes dangerous at this time (drawn as a warning before)
}

export interface ArenaDef {
  id: string;
  name: string;
  bounds: Rect;
  circle?: { cx: number; cy: number; r: number };
  walls: Wall[];
  floor: FloorPiece[] | null;
  rotors: Rotor[];
  spawn: { x: number; y: number };
  /** Edges hazards may enter from (0 top, 1 right, 2 bottom, 3 left). Defaults to all four. */
  spawnSides?: number[];
}

/** Seconds of warning before a floor piece disappears or a rotor arms. */
export const FLOOR_WARNING = 1.2;
const FALL_MARGIN = 8; // the player's centre may overhang an edge by this much before falling

// ---------- Queries ----------

export function wallAt(w: Wall, t: number): Rect {
  if (!w.move) return w;
  const k = 0.5 - 0.5 * Math.cos(((t / w.move.period) * 2 + (w.move.phase ?? 0)) * Math.PI);
  return { x: w.x + w.move.dx * k, y: w.y + w.move.dy * k, w: w.w, h: w.h };
}

export function wallsAt(a: ArenaDef, t: number): Rect[] {
  return a.walls.map((w) => wallAt(w, t));
}

export type FloorState = 'absent' | 'solid' | 'warning';

/** Is this piece of floor there now, and is it about to go? */
export function floorState(f: FloorPiece, t: number): FloorState {
  const warn = f.warn ?? FLOOR_WARNING;
  if (f.from !== undefined && t < f.from) return 'absent';
  if (f.until !== undefined) {
    if (t >= f.until) return 'absent';
    if (t >= f.until - warn) return 'warning';
  }
  if (f.cycle) {
    const c = f.cycle;
    const k = (((t - c.offset) % c.period) + c.period) % c.period;
    if (k >= c.on) return 'absent';
    if (k >= c.on - warn) return 'warning';
  }
  return 'solid';
}

const inRect = (r: Rect, x: number, y: number, pad = 0) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;

export function insideBoundary(a: ArenaDef, x: number, y: number, pad = 0): boolean {
  const b = a.bounds;
  if (x < b.x + pad || x > b.x + b.w - pad || y < b.y + pad || y > b.y + b.h - pad) return false;
  if (a.circle && Math.hypot(x - a.circle.cx, y - a.circle.cy) > a.circle.r - pad) return false;
  return true;
}

export function inWall(a: ArenaDef, t: number, x: number, y: number, pad = 0): boolean {
  return a.walls.some((w) => inRect(wallAt(w, t), x, y, pad));
}

/**
 * Whether a point is on floor that is present now and, with `lookahead`, stays present for the
 * whole window (sampled at least every 0.4s, so a bridge that vanishes and returns in between counts as unsafe).
 */
export function onFloor(a: ArenaDef, t: number, x: number, y: number, margin = FALL_MARGIN, lookahead = 0): boolean {
  if (!a.floor) return true;
  const steps = lookahead > 0 ? Math.ceil(lookahead / 0.4) : 0;
  for (let k = 0; k <= steps; k++) {
    const tk = t + (steps ? (lookahead * k) / steps : 0);
    if (!a.floor.some((f) => inRect(f, x, y, margin) && floorState(f, tk) !== 'absent')) return false;
  }
  return true;
}

/**
 * A spot the player could stand on safely right now and for the next `lookahead` seconds, with at
 * least `pad` of floor around it. The margin is checked against the floor as a whole (all pieces
 * together), so a point on the join between a bridge and a platform counts as solid ground.
 */
export function standable(a: ArenaDef, t: number, x: number, y: number, pad: number, lookahead = 0): boolean {
  if (!insideBoundary(a, x, y, pad) || inWall(a, t, x, y, pad)) return false;
  if (!a.floor) return true;
  const d = pad * 0.7071;
  const probes: [number, number][] = [[0, 0], [pad, 0], [-pad, 0], [0, pad], [0, -pad], [d, d], [d, -d], [-d, d], [-d, -d]];
  return probes.every(([dx, dy]) => onFloor(a, t, x + dx, y + dy, 0, lookahead));
}

/** Keep a circle of radius r inside the boundary and outside every wall. */
export function resolveBody(a: ArenaDef, t: number, p: { x: number; y: number }, r: number): void {
  const b = a.bounds;
  for (let pass = 0; pass < 3; pass++) {
    p.x = Math.min(b.x + b.w - r, Math.max(b.x + r, p.x));
    p.y = Math.min(b.y + b.h - r, Math.max(b.y + r, p.y));
    if (a.circle) {
      const dx = p.x - a.circle.cx;
      const dy = p.y - a.circle.cy;
      const d = Math.hypot(dx, dy);
      const max = a.circle.r - r;
      if (d > max && d > 0) {
        p.x = a.circle.cx + (dx / d) * max;
        p.y = a.circle.cy + (dy / d) * max;
      }
    }
    for (const w of wallsAt(a, t)) {
      // Closest point on the wall to the body; push out along that direction.
      const cx = Math.max(w.x, Math.min(p.x, w.x + w.w));
      const cy = Math.max(w.y, Math.min(p.y, w.y + w.h));
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d = Math.hypot(dx, dy);
      if (d >= r) continue;
      if (d > 0.0001) {
        p.x = cx + (dx / d) * r;
        p.y = cy + (dy / d) * r;
      } else {
        // Centre inside the wall: leave by the nearest side.
        const left = p.x - w.x;
        const right = w.x + w.w - p.x;
        const top = p.y - w.y;
        const bottom = w.y + w.h - p.y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) p.x = w.x - r;
        else if (m === right) p.x = w.x + w.w + r;
        else if (m === top) p.y = w.y - r;
        else p.y = w.y + w.h + r;
      }
    }
  }
}

/** Bounce a moving hazard off walls and the circular boundary. Returns true if it bounced. */
export function bounceHazard(a: ArenaDef, t: number, h: { x: number; y: number; vx: number; vy: number; r: number }): boolean {
  let bounced = false;
  for (const w of wallsAt(a, t)) {
    if (!inRect(w, h.x, h.y, h.r)) continue;
    const pens = [h.x + h.r - w.x, w.x + w.w - (h.x - h.r), h.y + h.r - w.y, w.y + w.h - (h.y - h.r)];
    const m = Math.min(...pens);
    if (m === pens[0] && h.vx > 0) (h.vx = -h.vx), (h.x = w.x - h.r);
    else if (m === pens[1] && h.vx < 0) (h.vx = -h.vx), (h.x = w.x + w.w + h.r);
    else if (m === pens[2] && h.vy > 0) (h.vy = -h.vy), (h.y = w.y - h.r);
    else if (m === pens[3] && h.vy < 0) (h.vy = -h.vy), (h.y = w.y + w.h + h.r);
    else continue;
    bounced = true;
  }
  return bounced;
}

export function rotorAngle(r: Rotor, t: number, arm: number): number {
  return r.angle + r.speed * t + (arm / r.arms) * Math.PI * 2;
}

export const rotorArmed = (r: Rotor, t: number) => r.from === undefined || t >= r.from;

export function rotorHits(r: Rotor, t: number, x: number, y: number, radius: number): boolean {
  if (!rotorArmed(r, t)) return false;
  for (let i = 0; i < r.arms; i++) {
    const a = rotorAngle(r, t, i);
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const rx = x - r.cx;
    const ry = y - r.cy;
    const along = rx * dx + ry * dy;
    if (along < 0 || along > r.length) continue;
    if (Math.abs(rx * dy - ry * dx) < r.half + radius) return true;
  }
  return false;
}

// ---------- The ten arenas ----------

const FULL: Rect = { x: 0, y: 0, w: 1000, h: 1000 };
const C = 500;

const grid: ArenaDef = {
  id: 'grid',
  name: 'The Grid',
  bounds: FULL,
  walls: [
    { x: 220, y: 220, w: 70, h: 70 },
    { x: 710, y: 220, w: 70, h: 70 },
    { x: 220, y: 710, w: 70, h: 70 },
    { x: 710, y: 710, w: 70, h: 70 },
  ],
  floor: null,
  rotors: [],
  spawn: { x: C, y: C },
};

/** Collapse: a 5x5 floor whose outer ring falls away one tile at a time. */
function collapseFloor(): FloorPiece[] {
  const tiles: FloorPiece[] = [];
  const ring: [number, number][] = [];
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 5; j++) {
      if (i === 0 || j === 0 || i === 4 || j === 4) ring.push([i, j]);
      else tiles.push({ x: i * 200, y: j * 200, w: 200, h: 200 });
    }
  // A fixed, scattered order so the collapse feels chaotic but is the same every run.
  const order = [0, 9, 4, 13, 2, 11, 6, 15, 1, 8, 5, 12, 3, 10, 7, 14];
  order.forEach((k, n) => {
    const [i, j] = ring[k];
    tiles.push({ x: i * 200, y: j * 200, w: 200, h: 200, until: 5 + n * 1.15, warn: 2 });
  });
  return tiles;
}

const collapse: ArenaDef = {
  id: 'collapse',
  name: 'Collapse',
  bounds: FULL,
  walls: [],
  floor: collapseFloor(),
  rotors: [],
  spawn: { x: C, y: C },
};

const T = 24; // wall thickness
const maze: ArenaDef = {
  id: 'maze',
  name: 'The Maze',
  bounds: FULL,
  walls: [
    { x: 200 - T / 2, y: 0, w: T, h: 330 },
    { x: 200 - T / 2, y: 520, w: T, h: 280 },
    { x: 400 - T / 2, y: 180, w: T, h: 300 },
    { x: 400 - T / 2, y: 660, w: T, h: 340 },
    { x: 600 - T / 2, y: 0, w: T, h: 340 },
    { x: 600 - T / 2, y: 520, w: T, h: 300 },
    { x: 800 - T / 2, y: 180, w: T, h: 300 },
    { x: 800 - T / 2, y: 660, w: T, h: 340 },
    { x: 200, y: 500 - T / 2, w: 120, h: T },
    { x: 480, y: 820 - T / 2, w: 120, h: T },
    { x: 680, y: 500 - T / 2, w: 120, h: T },
  ],
  floor: null,
  rotors: [],
  spawn: { x: 500, y: 430 },
};

const ring: ArenaDef = {
  id: 'ring',
  name: 'The Ring',
  bounds: FULL,
  circle: { cx: C, cy: C, r: 480 },
  walls: [{ x: C - 45, y: C - 45, w: 90, h: 90 }],
  floor: null,
  rotors: [{ cx: C, cy: C, length: 480, half: 8, speed: 0.45, arms: 2, angle: 0, from: 2 }],
  spawn: { x: C, y: C + 260 },
};

/** Two platforms over a chasm, joined by drawbridges; each side floods in turn. */
const split: ArenaDef = {
  id: 'split',
  name: 'Split Decision',
  bounds: FULL,
  walls: [],
  floor: [
    { x: 0, y: 0, w: 430, h: 1000, cycle: { period: 14, on: 10.5, offset: 0 }, warn: 3 }, // left: drops 10.5–14 each cycle
    { x: 570, y: 0, w: 430, h: 1000, cycle: { period: 14, on: 10.5, offset: 7 }, warn: 3 }, // right: drops 3.5–7 each cycle
    { x: 410, y: 120, w: 180, h: 150, cycle: { period: 5, on: 3.5, offset: 0 } },
    { x: 410, y: 425, w: 180, h: 150, cycle: { period: 5, on: 3.5, offset: 1.7 } },
    { x: 410, y: 730, w: 180, h: 150, cycle: { period: 5, on: 3.5, offset: 3.4 } },
  ],
  rotors: [],
  spawn: { x: 215, y: 500 },
};

const spiral: ArenaDef = {
  id: 'spiral',
  name: 'The Spiral',
  bounds: FULL,
  walls: [
    { x: 150, y: 150, w: 700, h: T },
    { x: 850 - T, y: 150, w: T, h: 700 },
    { x: 310, y: 850 - T, w: 540, h: T },
    { x: 310, y: 310, w: T, h: 540 },
    { x: 310, y: 310, w: 390, h: T },
    { x: 700 - T, y: 310, w: T, h: 390 },
    { x: 465, y: 700 - T, w: 235, h: T },
  ],
  floor: null,
  rotors: [],
  spawn: { x: 75, y: 500 },
};

const gauntlet: ArenaDef = {
  id: 'gauntlet',
  name: 'The Gauntlet',
  bounds: { x: 320, y: 0, w: 360, h: 1000 },
  walls: [
    { x: 320, y: 300, w: 90, h: T },
    { x: 590, y: 520, w: 90, h: T },
    { x: 320, y: 740, w: 90, h: T },
  ],
  floor: null,
  rotors: [],
  spawn: { x: 500, y: 500 },
  spawnSides: [0, 2],
};

/** Fracture: an asymmetric shattered floor with sliding walls, shrinking as pieces fall away. */
const fracture: ArenaDef = {
  id: 'fracture',
  name: 'Fracture',
  bounds: FULL,
  walls: [
    // Sliding walls only travel over floor that never falls, so they can never push anyone into the void.
    { x: 650, y: 60, w: T, h: 140, move: { dx: 0, dy: 280, period: 6, phase: 0.5 } },
    { x: 400, y: 380, w: 120, h: T, move: { dx: 80, dy: 0, period: 5 } },
  ],
  floor: [
    { x: 0, y: 0, w: 560, h: 360, until: 22, warn: 3 },
    { x: 620, y: 0, w: 380, h: 520 },
    { x: 0, y: 420, w: 380, h: 580, until: 15, warn: 3 },
    { x: 380, y: 360, w: 240, h: 300 }, // the heart: never falls
    { x: 380, y: 660, w: 620, h: 340, until: 28, warn: 3 },
    { x: 560, y: 360, w: 60, h: 160 },
  ],
  rotors: [],
  spawn: { x: 500, y: 510 },
};

/**
 * Each corner island has two L-shaped routes to the centre (one around each side) on opposite
 * rhythms, so at least one of them is always solid: the challenge is picking the right one.
 */
function voidBridges(): FloorPiece[] {
  const out: FloorPiece[] = [];
  const P = 7;
  const ON = 5.2;
  const mirror = (r: Rect, fx: boolean, fy: boolean): Rect => ({
    x: fx ? 1000 - r.x - r.w : r.x,
    y: fy ? 1000 - r.y - r.h : r.y,
    w: r.w,
    h: r.h,
  });
  // Top-left corner, route A (down the left side) and route B (across the top).
  const routeA: Rect[] = [
    { x: 130, y: 390, w: 240, h: 100 },
    { x: 130, y: 270, w: 100, h: 220 },
  ];
  const routeB: Rect[] = [
    { x: 390, y: 130, w: 100, h: 240 },
    { x: 270, y: 130, w: 220, h: 100 },
  ];
  const corners: [boolean, boolean, number][] = [
    [false, false, 0],
    [true, false, 1.75],
    [false, true, 5.25],
    [true, true, 3.5],
  ];
  for (const [fx, fy, base] of corners) {
    for (const r of routeA) out.push({ ...mirror(r, fx, fy), cycle: { period: P, on: ON, offset: base } });
    for (const r of routeB) out.push({ ...mirror(r, fx, fy), cycle: { period: P, on: ON, offset: (base + P / 2) % P } });
  }
  return out;
}

/** The Void: islands joined by bridges that come and go. */
const voidArena: ArenaDef = {
  id: 'void',
  name: 'The Void',
  bounds: FULL,
  walls: [],
  floor: [
    { x: 360, y: 360, w: 280, h: 280 },
    { x: 60, y: 60, w: 220, h: 220 },
    { x: 720, y: 60, w: 220, h: 220 },
    { x: 60, y: 720, w: 220, h: 220 },
    { x: 720, y: 720, w: 220, h: 220 },
    ...voidBridges(),
  ],
  rotors: [],
  spawn: { x: 500, y: 500 },
};

/** The boss arena changes shape as the fight goes on. */
const coreA: ArenaDef = { id: 'core', name: 'The Core', bounds: FULL, circle: { cx: C, cy: C, r: 485 }, walls: [], floor: null, rotors: [], spawn: { x: C, y: 820 } };
const coreB: ArenaDef = {
  ...coreA,
  id: 'core-pillars',
  walls: [
    { x: 250, y: 250, w: 60, h: 60 },
    { x: 690, y: 250, w: 60, h: 60 },
    { x: 250, y: 690, w: 60, h: 60 },
    { x: 690, y: 690, w: 60, h: 60 },
  ],
};
const coreC: ArenaDef = { ...coreB, id: 'core-tight', circle: { cx: C, cy: C, r: 420 } };
const coreD: ArenaDef = {
  ...coreA,
  id: 'core-final',
  circle: { cx: C, cy: C, r: 390 },
  rotors: [{ cx: C, cy: C, length: 390, half: 7, speed: 0.3, arms: 1, angle: Math.PI / 2, from: 2.5 }],
};

export const ARENAS = { grid, collapse, maze, ring, split, spiral, gauntlet, fracture, void: voidArena, coreA, coreB, coreC, coreD };

/** The plain full square used by Endless modes and as a safe default. */
export const OPEN_ARENA: ArenaDef = { id: 'open', name: 'Open Arena', bounds: FULL, walls: [], floor: null, rotors: [], spawn: { x: C, y: C } };
