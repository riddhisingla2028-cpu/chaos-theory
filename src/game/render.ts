import {
  AFTERIMAGE_ARM,
  AFTERIMAGE_LIFE,
  ARENA,
  BEAM_HALF,
  COLLAPSE_INSET,
  NOVA_GAP,
  NOVA_HALF,
  nextBossSpot,
  ORB_RADIUS,
  PLAYER_HALF,
  SWEEP_GAP_HALF,
  SWEEP_HALF,
  TRAIL_HIT_RADIUS,
  VOID_MARGIN,
  VOID_TILE,
  chaosHas,
  isActive,
  type GameState,
} from './engine';
import type { Fx } from './fx';
import { floorState, rotorAngle, rotorArmed, wallAt, type ArenaDef } from './arenas';
import { arenaTime } from './engine';
import { HULLS, type ShipId } from '../mission/render';
import { shapePoints } from './shapes';
import type { Motif } from './stages';
import type { ShapeId } from '../progress';

export interface Look {
  arena: string;
  accent: [number, number, number]; // hazards (from the player's theme)
  glow: [number, number, number]; // the level's neon colour: environment, orbs, border
  shape: ShapeId;
  motif: Motif;
  heat: number; // 0..1 accent vignette strength for the level
  shake: boolean;
  trail?: string; // cosmetic trail style (TrailId)
  ship?: ShipId; // equipped spacecraft hull
}

const TEXT = '#F3F0EA';
const text = (a: number) => `rgba(243, 240, 234, ${a})`;
let accentRgb: [number, number, number] = [200, 75, 75];
let glowRgb: [number, number, number] = [79, 227, 240];
const acc = (a: number) => `rgba(${accentRgb[0]}, ${accentRgb[1]}, ${accentRgb[2]}, ${a})`;
const neon = (a: number) => `rgba(${glowRgb[0]}, ${glowRgb[1]}, ${glowRgb[2]}, ${a})`;

/** Draws one frame. `sizePx` is the CSS size of the square canvas, `t` is wall-clock seconds for ambient animation. */
export function drawGame(
  ctx: CanvasRenderingContext2D,
  s: GameState,
  sizePx: number,
  dpr: number,
  t: number,
  fx: Fx,
  look: Look,
): void {
  accentRgb = look.accent;
  glowRgb = look.glow;
  const scale = sizePx / ARENA;
  const px = 1 / scale; // one CSS pixel in arena units

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const shake = look.shake ? fx.shake : 0;
  const ox = shake ? (Math.random() - 0.5) * shake : 0;
  const oy = shake ? (Math.random() - 0.5) * shake : 0;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, ox * dpr * scale, oy * dpr * scale);

  const arena = s.config.arena;
  const at = arenaTime(s);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, ARENA, ARENA);
  ctx.clip();
  // The void: anything that is not floor.
  drawVoidBackdrop(ctx, t);
  drawSpace(ctx, t);
  // The ground the player can stand on, with the level's pattern clipped to it. Slightly
  // translucent, so deep space shows faintly through the deck.
  ctx.save();
  groundPath(ctx, arena, at);
  ctx.globalAlpha = 0.86;
  ctx.fillStyle = look.arena;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.clip();
  drawMotif(ctx, look.motif, t, px);
  drawHeat(ctx, look.heat);
  ctx.restore();
  drawFloorEdges(ctx, arena, at, t, px);
  drawVoids(ctx, s, t);
  drawGravity(ctx, s, t);
  drawCollapse(ctx, s, t, px);
  drawHorizon(ctx, s, t, px);
  drawTrail(ctx, s, look.trail ?? 'classic', t);
  drawSweeps(ctx, s, t, px);
  drawWalls(ctx, arena, at, px);
  drawRotors(ctx, arena, at, t);
  drawOrbs(ctx, s, t);
  drawBoss(ctx, s, t, px);
  drawHazards(ctx, s, t);
  drawParticles(ctx, fx);
  drawPlayer(ctx, s, look.shape, t, look.ship ?? 'arrow');
  drawPopups(ctx, fx);
  if (isActive(s, 'GLITCH')) drawDistortion(ctx, t);
  if (fx.flash > 0) {
    ctx.fillStyle = acc(fx.flash * 0.22);
    ctx.fillRect(0, 0, ARENA, ARENA);
  }
  ctx.restore();

  // Neon border in the level colour; hazard colour while chaos is active.
  ctx.save();
  ctx.lineWidth = 2 * px;
  ctx.shadowBlur = 18;
  ctx.shadowColor = s.chaos?.phase === 'active' ? acc(0.8) : neon(0.7);
  ctx.strokeStyle = s.chaos?.phase === 'active' ? acc(0.75) : neon(0.45);
  ctx.strokeRect(px, px, ARENA - 2 * px, ARENA - 2 * px);
  ctx.restore();
}

// ---------- Space backdrop ----------

const STARS = Array.from({ length: 160 }, (_, i) => {
  const r = (n: number) => (Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1;
  const f = (n: number) => Math.abs(r(n));
  return { x: f(1) * ARENA, y: f(2) * ARENA, z: 0.25 + f(3) * 0.75, tw: f(4) * 6.28 };
});

/** Stars drifting slowly at different depths, and a nebula in the level colour. */
function drawSpace(ctx: CanvasRenderingContext2D, t: number): void {
  const n = ctx.createRadialGradient(ARENA * 0.72, ARENA * 0.28, 20, ARENA * 0.72, ARENA * 0.28, ARENA * 0.7);
  n.addColorStop(0, neon(0.1));
  n.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = n;
  ctx.fillRect(0, 0, ARENA, ARENA);
  for (const st of STARS) {
    const y = (st.y + t * 6 * st.z) % ARENA;
    const a = 0.25 + 0.55 * st.z * (0.7 + 0.3 * Math.sin(t * 2 + st.tw));
    ctx.fillStyle = `rgba(243, 240, 234, ${a})`;
    const sz = 0.8 + st.z * 1.8;
    ctx.fillRect(st.x, y, sz, sz);
  }
}

// ---------- Arena geometry ----------

/** Path of everything the player can currently stand on. */
function groundPath(ctx: CanvasRenderingContext2D, a: ArenaDef, at: number): void {
  ctx.beginPath();
  const b = a.bounds;
  if (a.floor) {
    for (const f of a.floor) if (floorState(f, at) !== 'absent') ctx.rect(f.x, f.y, f.w, f.h);
  } else if (a.circle) {
    ctx.arc(a.circle.cx, a.circle.cy, a.circle.r, 0, Math.PI * 2);
  } else {
    ctx.rect(b.x, b.y, b.w, b.h);
  }
}

function drawVoidBackdrop(ctx: CanvasRenderingContext2D, t: number): void {
  ctx.fillStyle = '#030305';
  ctx.fillRect(0, 0, ARENA, ARENA);
  // Slow drifting specks give the void depth without competing with hazards.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = 'rgba(243, 240, 234, 0.08)';
  for (let i = 0; i < 70; i++) {
    const x = (rand() * ARENA + t * (4 + rand() * 6)) % ARENA;
    const y = rand() * ARENA;
    const sz = 1 + rand() * 2.5;
    ctx.fillRect(x, y, sz, sz);
  }
}

function drawFloorEdges(ctx: CanvasRenderingContext2D, a: ArenaDef, at: number, t: number, px: number): void {
  ctx.save();
  ctx.lineWidth = 2 * px;
  if (a.floor) {
    for (const f of a.floor) {
      const st = floorState(f, at);
      if (st === 'absent') {
        // A floor piece that will appear soon is outlined faintly.
        if (f.from !== undefined && at < f.from && f.from - at < 2) {
          ctx.setLineDash([10, 10]);
          ctx.strokeStyle = neon(0.4);
          ctx.strokeRect(f.x + 3, f.y + 3, f.w - 6, f.h - 6);
          ctx.setLineDash([]);
        }
        continue;
      }
      if (st === 'warning') {
        // About to fall: flashing hazard stripes (pattern + motion, not colour alone).
        ctx.save();
        ctx.beginPath();
        ctx.rect(f.x, f.y, f.w, f.h);
        ctx.clip();
        ctx.strokeStyle = acc(0.35 + 0.3 * Math.sin(t * 20));
        ctx.lineWidth = 14;
        ctx.beginPath();
        for (let k = -f.h; k < f.w + f.h; k += 46) {
          ctx.moveTo(f.x + k, f.y);
          ctx.lineTo(f.x + k + f.h, f.y + f.h);
        }
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = acc(0.95);
      } else {
        ctx.strokeStyle = f.cycle ? neon(0.7) : neon(0.35);
      }
      ctx.lineWidth = (st === 'warning' ? 3 : 2) * px;
      ctx.strokeRect(f.x + px, f.y + px, f.w - 2 * px, f.h - 2 * px);
    }
  } else if (a.circle) {
    ctx.shadowColor = neon(0.8);
    ctx.shadowBlur = 18;
    ctx.strokeStyle = neon(0.6);
    ctx.lineWidth = 3 * px;
    ctx.beginPath();
    ctx.arc(a.circle.cx, a.circle.cy, a.circle.r, 0, Math.PI * 2);
    ctx.stroke();
  } else if (a.bounds.w < ARENA || a.bounds.h < ARENA) {
    ctx.shadowColor = neon(0.8);
    ctx.shadowBlur = 18;
    ctx.strokeStyle = neon(0.6);
    ctx.lineWidth = 3 * px;
    ctx.strokeRect(a.bounds.x, a.bounds.y, a.bounds.w, a.bounds.h);
  }
  ctx.restore();
}

function drawWalls(ctx: CanvasRenderingContext2D, a: ArenaDef, at: number, px: number): void {
  for (const w of a.walls) {
    if (w.move) {
      // Faint track showing where a sliding wall travels.
      ctx.fillStyle = neon(0.06);
      ctx.fillRect(Math.min(w.x, w.x + w.move.dx), Math.min(w.y, w.y + w.move.dy), w.w + Math.abs(w.move.dx), w.h + Math.abs(w.move.dy));
    }
    const r = wallAt(w, at);
    ctx.save();
    ctx.fillStyle = 'rgba(30, 30, 40, 0.95)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.shadowColor = neon(0.8);
    ctx.shadowBlur = 12;
    ctx.strokeStyle = neon(w.move ? 0.95 : 0.7);
    ctx.lineWidth = 2 * px;
    ctx.strokeRect(r.x + px, r.y + px, r.w - 2 * px, r.h - 2 * px);
    ctx.restore();
  }
}

function drawRotors(ctx: CanvasRenderingContext2D, a: ArenaDef, at: number, t: number): void {
  for (const rot of a.rotors) {
    const armed = rotorArmed(rot, at);
    for (let i = 0; i < rot.arms; i++) {
      const ang = rotorAngle(rot, at, i);
      ctx.save();
      ctx.lineCap = 'round';
      if (armed) {
        ctx.shadowColor = acc(1);
        ctx.shadowBlur = 18;
        ctx.strokeStyle = acc(0.95);
        ctx.lineWidth = rot.half * 2;
      } else {
        // Not dangerous yet: dashed and pulsing so the player learns its path first.
        ctx.setLineDash([16, 12]);
        ctx.strokeStyle = acc(0.3 + 0.3 * Math.sin(t * 12));
        ctx.lineWidth = 4;
      }
      ctx.beginPath();
      ctx.moveTo(rot.cx, rot.cy);
      ctx.lineTo(rot.cx + Math.cos(ang) * rot.length, rot.cy + Math.sin(ang) * rot.length);
      ctx.stroke();
      ctx.restore();
    }
  }
}

// ---------- Background ----------

function drawMotif(ctx: CanvasRenderingContext2D, motif: Motif, t: number, px: number): void {
  ctx.strokeStyle = neon(0.06);
  ctx.fillStyle = neon(0.1);
  ctx.lineWidth = px;
  ctx.beginPath();
  switch (motif) {
    case 'grid':
    case 'noise':
      for (let i = 100; i < ARENA; i += 100) {
        ctx.moveTo(i, 0);
        ctx.lineTo(i, ARENA);
        ctx.moveTo(0, i);
        ctx.lineTo(ARENA, i);
      }
      break;
    case 'mirror':
      for (let i = 125; i < ARENA; i += 125) {
        ctx.moveTo(i, 0);
        ctx.lineTo(i, ARENA);
        ctx.moveTo(0, i);
        ctx.lineTo(ARENA, i);
      }
      break;
    case 'frame':
      for (let i = 80; i < ARENA / 2; i += 80) ctx.rect(i, i, ARENA - 2 * i, ARENA - 2 * i);
      break;
    case 'currents':
      for (let y = 60; y < ARENA; y += 80) {
        for (let x = 0; x <= ARENA; x += 25) {
          const yy = y + Math.sin(x / 90 + t * 0.8 + y) * 10;
          if (x === 0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
      }
      break;
    case 'speed': {
      const off = (t * 160) % 90;
      for (let i = -ARENA; i < ARENA * 2; i += 90) {
        ctx.moveTo(i + off, 0);
        ctx.lineTo(i + off - ARENA * 0.6, ARENA);
      }
      break;
    }
    case 'scan':
      for (let y = 0; y < ARENA; y += 24) {
        ctx.moveTo(0, y);
        ctx.lineTo(ARENA, y);
      }
      break;
    case 'rings':
      for (let r = 100; r < 720; r += 100) {
        ctx.moveTo(ARENA / 2 + r, ARENA / 2);
        ctx.arc(ARENA / 2, ARENA / 2, r, 0, Math.PI * 2);
      }
      break;
    case 'dots':
    case 'void':
      break;
  }
  ctx.stroke();

  if (motif === 'mirror') {
    ctx.strokeStyle = neon(0.14);
    ctx.beginPath();
    ctx.moveTo(ARENA / 2, 0);
    ctx.lineTo(ARENA / 2, ARENA);
    ctx.moveTo(0, ARENA / 2);
    ctx.lineTo(ARENA, ARENA / 2);
    ctx.stroke();
  } else if (motif === 'dots') {
    for (let x = 50; x < ARENA; x += 50) for (let y = 50; y < ARENA; y += 50) ctx.fillRect(x - 2, y - 2, 4, 4);
  } else if (motif === 'void') {
    ctx.strokeStyle = neon(0.12);
    ctx.beginPath();
    for (let x = 125; x < ARENA; x += 125) {
      for (let y = 125; y < ARENA; y += 125) {
        ctx.moveTo(x - 8, y);
        ctx.lineTo(x + 8, y);
        ctx.moveTo(x, y - 8);
        ctx.lineTo(x, y + 8);
      }
    }
    ctx.stroke();
  } else if (motif === 'scan') {
    const y = (t * 140) % (ARENA + 200) - 100;
    ctx.fillStyle = neon(0.05);
    ctx.fillRect(0, y, ARENA, 60);
  } else if (motif === 'noise') {
    // Deterministic static that changes a few times a second.
    let seed = Math.floor(t * 6) * 9301 + 49297;
    const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    ctx.fillStyle = neon(0.05);
    for (let i = 0; i < 18; i++) ctx.fillRect(Math.floor(rand() * 10) * 100, Math.floor(rand() * 10) * 100, 100, 100);
  }
}

function drawHeat(ctx: CanvasRenderingContext2D, heat: number): void {
  const g = ctx.createRadialGradient(ARENA / 2, ARENA / 2, ARENA * 0.2, ARENA / 2, ARENA / 2, ARENA * 0.75);
  g.addColorStop(0, neon(0.035));
  g.addColorStop(1, heat > 0 ? acc(0.12 * heat) : 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ARENA, ARENA);
}

// ---------- Level mechanics ----------

function drawVoids(ctx: CanvasRenderingContext2D, s: GameState, t: number): void {
  for (const v of s.voids) {
    const x = v.ix * VOID_TILE;
    const y = v.iy * VOID_TILE;
    if (v.phase === 'warning') {
      // Flickering hatch: this tile is about to vanish.
      const a = 0.18 + 0.18 * Math.sin(t * 22);
      ctx.fillStyle = acc(a);
      ctx.fillRect(x + 4, y + 4, VOID_TILE - 8, VOID_TILE - 8);
      ctx.strokeStyle = acc(0.85);
      ctx.lineWidth = 3;
      ctx.setLineDash([16, 12]);
      ctx.strokeRect(x + 6, y + 6, VOID_TILE - 12, VOID_TILE - 12);
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(x, y, VOID_TILE, VOID_TILE);
      ctx.save();
      ctx.strokeStyle = acc(0.9);
      ctx.lineWidth = 3;
      ctx.shadowColor = acc(0.9);
      ctx.shadowBlur = 16;
      ctx.strokeRect(x + VOID_MARGIN, y + VOID_MARGIN, VOID_TILE - 2 * VOID_MARGIN, VOID_TILE - 2 * VOID_MARGIN);
      ctx.restore();
    }
  }
}

function drawOrbs(ctx: CanvasRenderingContext2D, s: GameState, t: number): void {
  for (const o of s.orbs) {
    const pop = Math.min(1, o.age * 4);
    const pulse = 1 + Math.sin(t * (o.bonus ? 10 : 6) + o.id) * 0.12;
    const r = ORB_RADIUS * pop * pulse * (o.bonus ? 1.15 : 1);
    const col = o.bonus ? (a: number) => `rgba(255, 213, 74, ${a})` : neon;
    ctx.save();
    ctx.translate(o.x, o.y);
    if (o.bonus) {
      // Countdown ring: gold orbs vanish after five seconds.
      const left = Math.max(0, 1 - o.age / 5);
      ctx.strokeStyle = col(0.9);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, r * 2, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2);
      ctx.stroke();
    }
    // Halo
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 3.2);
    halo.addColorStop(0, col(0.35));
    halo.addColorStop(1, col(0));
    ctx.fillStyle = halo;
    ctx.fillRect(-r * 3.2, -r * 3.2, r * 6.4, r * 6.4);
    // Diamond core
    ctx.rotate(t * 1.5);
    ctx.shadowColor = col(1);
    ctx.shadowBlur = 20;
    ctx.fillStyle = col(0.95);
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.8, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r * 0.8, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawBoss(ctx: CanvasRenderingContext2D, s: GameState, t: number, px: number): void {
  const b = s.boss;
  if (!b) return;
  const a = b.attack;

  if (b.hp <= 0 && s.config.bossRush && s.bossRespawn < 1.2) {
    // Boss Rush: the next Core is about to materialise.
    const k = 1 - Math.max(0, s.bossRespawn) / 1.2;
    ctx.save();
    ctx.strokeStyle = acc(0.3 + 0.5 * Math.abs(Math.sin(t * 12)));
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 10]);
    const at = nextBossSpot(s);
    ctx.beginPath();
    ctx.arc(at.x, at.y, b.r + 140 * (1 - k), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (a?.kind === 'nova') {
    // Shockwave: a ring with one safe gap, marked in the level colour.
    const g0 = a.angle - NOVA_GAP;
    const g1 = a.angle + NOVA_GAP;
    ctx.save();
    if (a.phase === 'tell') {
      ctx.strokeStyle = acc(0.45 + 0.4 * Math.sin(t * 18));
      ctx.lineWidth = 5;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 70, g1, g0 + Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // An arrow out through the gap.
      ctx.strokeStyle = neon(0.95);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(b.x + Math.cos(a.angle) * (b.r + 40), b.y + Math.sin(a.angle) * (b.r + 40));
      ctx.lineTo(b.x + Math.cos(a.angle) * (b.r + 160), b.y + Math.sin(a.angle) * (b.r + 160));
      ctx.stroke();
    } else {
      ctx.shadowColor = acc(1);
      ctx.shadowBlur = 24;
      ctx.strokeStyle = acc(0.95);
      ctx.lineWidth = NOVA_HALF * 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, a.radius, g1, g0 + Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = neon(0.9);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(b.x, b.y, a.radius, g0, g1);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Telegraphs and beams sit under the core.
  if (a?.kind === 'burst' && a.phase === 'tell') {
    const gapStart = a.angle;
    const gapEnd = a.angle + (3 / 16) * Math.PI * 2;
    ctx.strokeStyle = acc(0.5 + 0.4 * Math.sin(t * 20));
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r + 40, gapEnd, gapStart + Math.PI * 2);
    ctx.stroke();
    // Bright marker where the gap is: the safe way out.
    ctx.strokeStyle = neon(0.9);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r + 40, gapStart, gapEnd);
    ctx.stroke();
  }
  for (const angle of a?.kind === 'beam' ? [a.angle] : a?.kind === 'twin' ? [a.angle, a.angle + Math.PI] : []) {
    const len = ARENA * 1.5;
    const ex = b.x + Math.cos(angle) * len;
    const ey = b.y + Math.sin(angle) * len;
    ctx.save();
    ctx.lineCap = 'round';
    if (a!.phase === 'tell') {
      ctx.setLineDash([18, 14]);
      ctx.strokeStyle = acc(0.45 + 0.35 * Math.sin(t * 18));
      ctx.lineWidth = 4;
    } else {
      ctx.shadowColor = acc(1);
      ctx.shadowBlur = 30;
      ctx.strokeStyle = acc(0.95);
      ctx.lineWidth = BEAM_HALF * 2;
    }
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    if (a!.phase === 'fire') {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 4;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (b.hp <= 0) return;
  ctx.save();
  ctx.translate(b.x, b.y);
  if (b.shield > 0) {
    // Phase-change shield: the Core is regrouping and cannot be hit or attack.
    ctx.strokeStyle = neon(0.4 + 0.4 * Math.sin(t * 14));
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, b.r + 62, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Rotating outer rings
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate(t * (0.6 + i * 0.35) * (i % 2 ? -1 : 1));
    ctx.strokeStyle = acc(0.35 - i * 0.08);
    ctx.lineWidth = 2;
    ctx.setLineDash([24 - i * 6, 14]);
    ctx.beginPath();
    ctx.arc(0, 0, b.r + 14 + i * 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  // Core
  const charging = a?.phase === 'tell';
  ctx.shadowColor = b.hitFlash > 0 ? 'rgba(255,255,255,1)' : acc(1);
  ctx.shadowBlur = 40 + (charging ? Math.sin(t * 30) * 15 : 0);
  ctx.fillStyle = b.hitFlash > 0 ? TEXT : acc(0.95);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const ang = t * 0.4 + (i / 6) * Math.PI * 2;
    const rr = b.r * (1 + (charging ? 0.06 * Math.sin(t * 30 + i) : 0));
    if (i === 0) ctx.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
    else ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#0b0b0d';
  ctx.beginPath();
  ctx.arc(0, 0, b.r * 0.42, 0, Math.PI * 2);
  ctx.fill();
  // HP segments around the core
  for (let i = 0; i < b.maxHp; i++) {
    const a0 = -Math.PI / 2 + (i / b.maxHp) * Math.PI * 2 + 0.06;
    const a1 = -Math.PI / 2 + ((i + 1) / b.maxHp) * Math.PI * 2 - 0.06;
    ctx.strokeStyle = i < b.hp ? neon(0.95) : text(0.12);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, b.r + 8, a0, a1);
    ctx.stroke();
  }
  ctx.restore();
  void px;
}

function drawDistortion(ctx: CanvasRenderingContext2D, t: number): void {
  // Horizontal tear lines and colour bands: unsettling but never hiding hazards.
  let seed = Math.floor(t * 14) * 7919 + 13;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 4; i++) {
    const y = rand() * ARENA;
    const h = 4 + rand() * 18;
    ctx.fillStyle = i % 2 ? neon(0.1) : acc(0.08);
    ctx.fillRect((rand() - 0.5) * 60, y, ARENA, h);
  }
  ctx.fillStyle = text(0.05);
  ctx.fillRect(0, (t * 900) % ARENA, ARENA, 2);
}

// ---------- Chaos visuals ----------

function drawGravity(ctx: CanvasRenderingContext2D, s: GameState, t: number): void {
  const c = s.chaos;
  if (!c || !chaosHas(c, 'GRAVITY')) return;
  const spacing = 120;
  const offset = (t * 160) % spacing;
  ctx.save();
  ctx.translate(ARENA / 2, ARENA / 2);
  ctx.rotate(Math.atan2(c.gravity.y, c.gravity.x));
  ctx.strokeStyle = c.phase === 'active' ? text(0.11) : text(0.05 + 0.04 * Math.sin(t * 8));
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let y = -720; y <= 720; y += spacing) {
    for (let x = -840; x <= 720; x += spacing) {
      const cx = x + offset;
      ctx.moveTo(cx - 10, y - 14);
      ctx.lineTo(cx + 4, y);
      ctx.lineTo(cx - 10, y + 14);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawCollapse(ctx: CanvasRenderingContext2D, s: GameState, t: number, px: number): void {
  const i = s.inset;
  if (i > 0.5) {
    ctx.fillStyle = acc(0.16);
    ctx.fillRect(0, 0, ARENA, i);
    ctx.fillRect(0, ARENA - i, ARENA, i);
    ctx.fillRect(0, i, i, ARENA - 2 * i);
    ctx.fillRect(ARENA - i, i, i, ARENA - 2 * i);
    ctx.save();
    ctx.shadowColor = acc(1);
    ctx.shadowBlur = 14;
    ctx.strokeStyle = acc(0.9);
    ctx.lineWidth = 2 * px;
    ctx.strokeRect(i, i, ARENA - 2 * i, ARENA - 2 * i);
    ctx.restore();
  }
  const c = s.chaos;
  if (c && chaosHas(c, 'COLLAPSE') && c.phase === 'warning') {
    ctx.setLineDash([14, 10]);
    ctx.strokeStyle = acc(0.4 + 0.35 * Math.sin(t * 10));
    ctx.lineWidth = 2 * px;
    ctx.strokeRect(COLLAPSE_INSET, COLLAPSE_INSET, ARENA - 2 * COLLAPSE_INSET, ARENA - 2 * COLLAPSE_INSET);
    ctx.setLineDash([]);
  }
}

function drawHorizon(ctx: CanvasRenderingContext2D, s: GameState, t: number, px: number): void {
  const c = s.chaos;
  if (!c || !chaosHas(c, 'HORIZON') || !c.zone) return;
  const z = c.zone;
  if (c.phase === 'warning') {
    ctx.setLineDash([14, 10]);
    ctx.strokeStyle = acc(0.4 + 0.35 * Math.sin(t * 10));
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  ctx.beginPath();
  ctx.rect(0, 0, ARENA, ARENA);
  ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2, true);
  ctx.fillStyle = acc(0.16);
  ctx.fill('evenodd');
  ctx.beginPath();
  ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
  ctx.strokeStyle = acc(0.9);
  ctx.lineWidth = 2.5 * px;
  ctx.stroke();
}

function drawTrail(ctx: CanvasRenderingContext2D, s: GameState, style: string, t: number): void {
  const trail = s.trail;
  if (trail.length < 2 || isActive(s, 'PHANTOM')) return;
  const c = s.chaos;
  const warning = c !== null && chaosHas(c, 'AFTERIMAGE') && c.phase === 'warning';
  // Cosmetic styles step aside whenever the trail carries gameplay meaning (Afterimage).
  if (style !== 'classic' && !warning && !isActive(s, 'AFTERIMAGE')) {
    drawCosmeticTrail(ctx, s, style, t);
    return;
  }

  ctx.beginPath();
  let started = false;
  for (const p of trail) {
    if (s.time - p.t > 0.5) continue;
    if (!started) {
      ctx.moveTo(p.x, p.y);
      started = true;
    } else ctx.lineTo(p.x, p.y);
  }
  ctx.lineTo(s.player.x, s.player.y);
  ctx.strokeStyle = warning ? acc(0.3) : neon(0.12);
  ctx.lineWidth = PLAYER_HALF;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  if (!isActive(s, 'AFTERIMAGE')) return;
  const since = c!.startedAt;
  for (const p of trail) {
    if (p.t < since) continue;
    const age = s.time - p.t;
    ctx.beginPath();
    if (age >= AFTERIMAGE_ARM && age <= AFTERIMAGE_LIFE) {
      const fade = 1 - (age - AFTERIMAGE_ARM) / (AFTERIMAGE_LIFE - AFTERIMAGE_ARM);
      ctx.fillStyle = acc(0.12 + 0.8 * fade);
      ctx.arc(p.x, p.y, TRAIL_HIT_RADIUS, 0, Math.PI * 2);
    } else if (age < AFTERIMAGE_ARM) {
      ctx.fillStyle = text(0.3);
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    } else continue;
    ctx.fill();
  }
}

function drawCosmeticTrail(ctx: CanvasRenderingContext2D, s: GameState, style: string, t: number): void {
  const pts = s.trail.filter((p) => s.time - p.t <= 0.5);
  pts.push({ x: s.player.x, y: s.player.y, t: s.time } as (typeof s.trail)[number]);
  if (pts.length < 2) return;
  ctx.lineCap = 'round';
  if (style === 'halo') {
    // Chaos+ only: thin golden rings that widen as they fade.
    for (let i = 0; i < pts.length - 1; i += 3) {
      const a = 1 - (s.time - pts[i].t) / 0.5;
      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, 4 + (1 - a) * 12, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 213, 74, ${0.55 * a})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    return;
  }
  if (style === 'beads') {
    for (let i = 0; i < pts.length - 1; i += 2) {
      const a = 1 - (s.time - pts[i].t) / 0.5;
      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, 2 + 4 * a, 0, Math.PI * 2);
      ctx.fillStyle = neon(0.45 * a);
      ctx.fill();
    }
    return;
  }
  for (let i = 1; i < pts.length; i++) {
    const a = 1 - (s.time - pts[i].t) / 0.5;
    ctx.beginPath();
    ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
    ctx.lineTo(pts[i].x, pts[i].y);
    if (style === 'prism') {
      ctx.strokeStyle = `hsla(${(t * 120 + i * 14) % 360}, 90%, 65%, ${0.35 * a})`;
      ctx.lineWidth = PLAYER_HALF * (0.4 + 0.6 * a);
    } else {
      // comet
      ctx.strokeStyle = neon(0.4 * a);
      ctx.lineWidth = PLAYER_HALF * 1.3 * a;
    }
    ctx.stroke();
  }
}

function drawSweeps(ctx: CanvasRenderingContext2D, s: GameState, t: number, px: number): void {
  const beam = (axis: 'x' | 'y', pos: number, gap: number, half: number) => {
    const lo = gap - SWEEP_GAP_HALF;
    const hi = gap + SWEEP_GAP_HALF;
    if (axis === 'x') {
      ctx.fillRect(pos - half, 0, half * 2, lo);
      ctx.fillRect(pos - half, hi, half * 2, ARENA - hi);
    } else {
      ctx.fillRect(0, pos - half, lo, half * 2);
      ctx.fillRect(hi, pos - half, ARENA - hi, half * 2);
    }
  };

  // Preview where the next beam will enter and where its gap is.
  const plan = s.chaos && chaosHas(s.chaos, 'SCANLINE') ? s.chaos.nextSweep : null;
  if (plan) {
    const edge = plan.dir === 1 ? 6 : ARENA - 6;
    ctx.fillStyle = acc(0.35 + 0.3 * Math.sin(t * 10));
    beam(plan.axis, edge, plan.gap, 4);
    ctx.strokeStyle = text(0.6);
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    for (const g of [plan.gap - SWEEP_GAP_HALF, plan.gap + SWEEP_GAP_HALF]) {
      if (plan.axis === 'x') {
        ctx.moveTo(edge - 14, g);
        ctx.lineTo(edge + 14, g);
      } else {
        ctx.moveTo(g, edge - 14);
        ctx.lineTo(g, edge + 14);
      }
    }
    ctx.stroke();
  }

  for (const sw of s.sweeps) {
    ctx.save();
    ctx.shadowColor = acc(0.8);
    ctx.shadowBlur = 14;
    ctx.fillStyle = acc(0.95);
    beam(sw.axis, sw.pos, sw.gap, SWEEP_HALF);
    ctx.restore();
  }
}

function drawHazards(ctx: CanvasRenderingContext2D, s: GameState, t: number): void {
  const surge = isActive(s, 'SURGE');
  const glitch = isActive(s, 'GLITCH');
  for (const h of s.hazards) {
    if (h.blink) {
      // Ghost at the teleport destination, growing more solid as the jump approaches.
      const k = 1 - h.blink.t / 0.45;
      ctx.strokeStyle = acc(0.3 + 0.6 * k);
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(h.blink.x, h.blink.y, h.r + 10 * (1 - k), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (surge) {
      ctx.strokeStyle = acc(0.3);
      ctx.lineWidth = h.r * 1.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(h.x - h.vx * 0.12, h.y - h.vy * 0.12);
      ctx.lineTo(h.x, h.y);
      ctx.stroke();
    }
    if (glitch) {
      const j = Math.sin(t * 40 + h.id) * 6;
      ctx.fillStyle = neon(0.25);
      ctx.fillRect(h.x - h.r + j, h.y - h.r * 0.3, h.r * 2, h.r * 0.6);
    }
    const fading = h.blink ? 0.45 : 1;
    if (h.kind === 'drifter') {
      ctx.save();
      // An asteroid: a dark, jagged rock with a hot rim. Its radius is the collision radius.
      ctx.translate(h.x, h.y);
      ctx.rotate(h.age * (0.6 + (h.id % 5) * 0.15) * (h.id % 2 ? 1 : -1));
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const rr = h.r * (0.86 + 0.14 * Math.sin(k * 2.3 + h.id * 1.7));
        if (k === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(36, 22, 20, ${0.95 * fading})`;
      ctx.fill();
      ctx.shadowColor = acc(0.9);
      ctx.shadowBlur = 12;
      ctx.strokeStyle = acc(0.95 * fading);
      ctx.lineWidth = 2.6;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = acc(0.35 * fading);
      ctx.beginPath();
      ctx.arc(-h.r * 0.25, -h.r * 0.2, h.r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.save();
      if (h.weave) {
        // Weavers wear a wobbling outer ring so their side-to-side motion is expected.
        ctx.shadowBlur = 0;
        ctx.strokeStyle = acc(0.55 * fading);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(h.x, h.y, h.r + 7, h.r + 3 + Math.abs(Math.sin(h.age * 2.6)) * 5, Math.atan2(h.vy, h.vx), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    } else {
      const alpha = Math.min(1, h.life - h.age, h.age * 3) * fading;
      const size = h.r * 1.35;
      ctx.save();
      ctx.translate(h.x, h.y);
      ctx.rotate(Math.atan2(h.vy, h.vx));
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.8, size * 0.8);
      ctx.lineTo(-size * 0.8, -size * 0.8);
      ctx.closePath();
      ctx.fillStyle = acc(0.25 * alpha);
      ctx.fill();
      ctx.strokeStyle = acc(alpha);
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    }
  }
}

// ---------- Player and effects ----------

function tracePlayer(ctx: CanvasRenderingContext2D, shape: ShapeId, r: number): void {
  const pts = shapePoints(shape, r);
  ctx.beginPath();
  if (!pts) {
    ctx.arc(0, 0, r * 1.1, 0, Math.PI * 2);
    return;
  }
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

// The player is a spacecraft: it turns smoothly towards its direction of travel, banks, and
// fires its engine in proportion to speed. Its hit circle (PLAYER_HIT_RADIUS) is the hull's core.
let shipAngle = -Math.PI / 2;
const SHIP_SCALE = 0.72;

function drawPlayer(ctx: CanvasRenderingContext2D, s: GameState, shape: ShapeId, t: number, ship: ShipId): void {
  const p = s.player;
  const speed = Math.hypot(p.vx, p.vy);
  if (speed > 25) {
    let diff = Math.atan2(p.vy, p.vx) - shipAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    shipAngle += diff * 0.25;
  }
  if (s.time < 0.05) shipAngle = -Math.PI / 2;
  const phantom = isActive(s, 'PHANTOM') && s.status === 'playing';

  ctx.save();
  ctx.translate(p.x, p.y);
  if (phantom) {
    // Invisible except for a regular sonar ping.
    const phase = (s.time % 0.8) / 0.8;
    if (phase < 0.6) {
      ctx.strokeStyle = text(0.7 * (1 - phase / 0.6));
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 10 + phase * 55, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.05;
  }
  ctx.rotate(shipAngle);
  const lateral = (-p.vx * Math.sin(shipAngle) + p.vy * Math.cos(shipAngle)) / 380;
  ctx.scale(SHIP_SCALE, SHIP_SCALE * (1 - Math.min(0.22, Math.abs(lateral) * 0.22)));
  const dead = s.status === 'over';
  // Engine flame
  if (!dead) {
    const flame = 8 + Math.min(1, speed / 380) * 26 + Math.sin(t * 40) * 3;
    const fg = ctx.createLinearGradient(-12, 0, -12 - flame, 0);
    fg.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    fg.addColorStop(0.3, neon(0.9));
    fg.addColorStop(1, 'rgba(255, 79, 216, 0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-10, -6);
    ctx.lineTo(-12 - flame, 0);
    ctx.lineTo(-10, 6);
    ctx.closePath();
    ctx.fill();
  }
  const pts = HULLS[ship] ?? HULLS.arrow;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  if (dead) {
    ctx.strokeStyle = acc(1);
    ctx.lineWidth = 3;
    ctx.stroke();
  } else if (isActive(s, 'INVERSION')) {
    // Hollow hull signals that controls are inverted.
    ctx.shadowColor = neon(0.9);
    ctx.shadowBlur = 20;
    ctx.strokeStyle = TEXT;
    ctx.lineWidth = 3.5;
    ctx.stroke();
  } else {
    const hg = ctx.createLinearGradient(-16, -20, 26, 20);
    hg.addColorStop(0, '#1b2440');
    hg.addColorStop(1, '#33447a');
    ctx.fillStyle = hg;
    ctx.shadowColor = neon(0.9);
    ctx.shadowBlur = 20 + Math.sin(t * 4) * 4;
    ctx.fill();
    ctx.strokeStyle = TEXT;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.shadowBlur = 0;
    // Cockpit
    ctx.fillStyle = 'rgba(232, 251, 255, 0.95)';
    ctx.beginPath();
    ctx.ellipse(5, 0, 8, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // The chosen emblem (skin) on the hull
    ctx.save();
    ctx.translate(-6, 0);
    tracePlayer(ctx, shape, 3.2);
    ctx.fillStyle = neon(0.95);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawParticles(ctx: CanvasRenderingContext2D, fx: Fx): void {
  for (const rg of fx.rings) {
    if (rg.life > rg.max) continue;
    ctx.beginPath();
    ctx.arc(rg.x, rg.y, rg.r, 0, Math.PI * 2);
    ctx.strokeStyle = rg.color;
    ctx.globalAlpha = Math.max(0, rg.life / rg.max);
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  for (const pt of fx.particles) {
    const a = pt.life / pt.max;
    ctx.fillStyle = pt.color ?? (pt.accent ? acc(a) : text(a * 0.6));
    if (pt.color) ctx.globalAlpha = a;
    const sz = pt.size * (0.4 + a * 0.6);
    ctx.fillRect(pt.x - sz / 2, pt.y - sz / 2, sz, sz);
    ctx.globalAlpha = 1;
  }
}

function drawPopups(ctx: CanvasRenderingContext2D, fx: Fx): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const pop of fx.popups) {
    const a = Math.min(1, (pop.life / pop.max) * 1.6);
    ctx.font = `700 ${pop.big ? 58 : 32}px Unbounded, ui-sans-serif, system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = pop.big ? neon(a) : text(a);
    ctx.fillText(pop.text, pop.x, pop.y);
  }
}

// ---------- Multiplayer ----------

/** Distinct, colour-blind-friendlier player colours; each player also keeps their own shape and name tag. */
export const MP_COLORS: [number, number, number][] = [
  [79, 227, 240],
  [255, 79, 216],
  [255, 213, 74],
  [91, 240, 138],
  [155, 123, 255],
  [255, 140, 66],
];

export interface MatchRenderData {
  time: number;
  arena: ArenaDef;
  players: { id: string; name: string; shape: string; color: number; x: number; y: number; alive: boolean; connected: boolean; grace: number }[];
  hazards: { x: number; y: number; r: number; seek: boolean }[];
  orbs: { x: number; y: number }[];
  me: string;
}

const mpHeading = new Map<string, { x: number; y: number; a: number }>();

export function drawMatch(ctx: CanvasRenderingContext2D, d: MatchRenderData, sizePx: number, dpr: number, t: number): void {
  accentRgb = [255, 90, 90];
  glowRgb = [79, 227, 240];
  const scale = sizePx / ARENA;
  const px = 1 / scale;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  const a = d.arena;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, ARENA, ARENA);
  ctx.clip();
  drawVoidBackdrop(ctx, t);
  ctx.save();
  groundPath(ctx, a, d.time);
  ctx.fillStyle = '#121216';
  ctx.fill();
  ctx.clip();
  drawMotif(ctx, 'grid', t, px);
  ctx.restore();
  drawFloorEdges(ctx, a, d.time, t, px);
  drawWalls(ctx, a, d.time, px);
  drawRotors(ctx, a, d.time, t);

  for (const o of d.orbs) {
    const pulse = 1 + Math.sin(t * 5 + o.x) * 0.12;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(Math.PI / 4);
    ctx.shadowColor = 'rgba(255, 213, 74, 0.9)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#FFD54A';
    const r = 9 * pulse;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  }

  for (const [hi, h] of d.hazards.entries()) {
    ctx.save();
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + t * 0.5 * (hi % 2 ? 1 : -1);
      const rr = h.r * (0.86 + 0.14 * Math.sin(k * 2.3 + hi));
      if (k === 0) ctx.moveTo(h.x + Math.cos(a) * rr, h.y + Math.sin(a) * rr);
      else ctx.lineTo(h.x + Math.cos(a) * rr, h.y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(36, 22, 20, 0.95)';
    ctx.fill();
    ctx.shadowColor = acc(0.8);
    ctx.shadowBlur = 10;
    ctx.strokeStyle = acc(0.95);
    ctx.lineWidth = 2.6;
    ctx.stroke();
    if (h.seek) {
      // Seekers wear a ring so the chase is readable without relying on colour.
      ctx.shadowBlur = 0;
      ctx.strokeStyle = acc(0.6);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const p of d.players) {
    if (!p.connected) continue;
    const [r, g, b] = MP_COLORS[p.color % MP_COLORS.length];
    const col = (al: number) => `rgba(${r}, ${g}, ${b}, ${al})`;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.id === d.me) {
      // A ring marks you among the other players.
      ctx.strokeStyle = col(0.5);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 24, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Each player flies a spacecraft in their colour, turned towards where they are going.
    const prev = mpHeading.get(p.id);
    let ang = prev?.a ?? -Math.PI / 2;
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) > 0.8) {
      let diff = Math.atan2(p.y - prev.y, p.x - prev.x) - ang;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      ang += diff * 0.3;
    }
    mpHeading.set(p.id, { x: p.x, y: p.y, a: ang });
    ctx.save();
    ctx.rotate(ang);
    ctx.scale(SHIP_SCALE, SHIP_SCALE);
    if (p.alive) {
      ctx.fillStyle = col(0.75);
      ctx.beginPath();
      ctx.moveTo(-10, -5);
      ctx.lineTo(-24 - Math.sin(t * 40) * 3, 0);
      ctx.lineTo(-10, 5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    HULLS.arrow.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    if (!p.alive) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = col(0.6);
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.globalAlpha = p.grace > 0 && Math.floor(t * 10) % 2 === 0 ? 0.45 : 1;
      ctx.fillStyle = '#1b2440';
      ctx.shadowColor = col(0.9);
      ctx.shadowBlur = 18;
      ctx.fill();
      ctx.strokeStyle = col(1);
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.save();
      ctx.translate(-4, 0);
      tracePlayer(ctx, p.shape as ShapeId, 4);
      ctx.fillStyle = col(1);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    ctx.restore();
    ctx.font = '600 22px Inter, ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = p.alive ? text(0.85) : text(0.4);
    ctx.fillText(p.id === d.me ? `${p.name} (you)` : p.name, p.x, p.y - 22);
  }
  ctx.restore();

  ctx.save();
  ctx.lineWidth = 2 * px;
  ctx.shadowBlur = 18;
  ctx.shadowColor = neon(0.7);
  ctx.strokeStyle = neon(0.45);
  ctx.strokeRect(px, px, ARENA - 2 * px, ARENA - 2 * px);
  ctx.restore();
}
