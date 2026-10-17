// Canvas rendering for spacecraft missions. Everything is procedural (no image assets).
// Draws the world only; the HUD is React. Collision shapes in sim.ts match what is drawn here:
// the ship's hit circle is its central core, walls are exact rectangles, beams are exact lines.

import type { Fx } from '../game/fx';
import { BEAM_HALF, BEAM_LENGTH, CHRONO_DURATION, PULSE_BAND, PULSE_GAP, VIEW, barrierState, objectiveTarget, wallAt, type MissionState } from './sim';

export type ShipId = 'arrow' | 'interceptor' | 'manta' | 'phantom';

export interface MissionLook {
  ship: ShipId;
  trail: string; // TrailId from progression (classic, comet, beads, prism, halo)
  reducedMotion: boolean;
}

type RGB = [number, number, number];
const rgba = (c: RGB, a: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
const CYAN: RGB = [79, 227, 240];
const MAGENTA: RGB = [255, 79, 216];
const VIOLET: RGB = [155, 123, 255];
const ORANGE: RGB = [255, 140, 66];
const RED: RGB = [255, 72, 88];
const GOLD: RGB = [255, 213, 74];
const WHITE: RGB = [243, 240, 234];

/** Per-run render memory: engine trail and star field. */
export interface RenderMemory {
  trail: { x: number; y: number; t: number }[];
  stars: { x: number; y: number; z: number; tw: number }[];
}

export function createRenderMemory(seed: number): RenderMemory {
  let a = seed >>> 0 || 1;
  const rnd = () => {
    a = (Math.imul(a ^ (a >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return a / 4294967296;
  };
  const stars = Array.from({ length: 140 }, () => ({ x: rnd() * VIEW, y: rnd() * VIEW, z: 0.2 + rnd() * 0.8, tw: rnd() * 6.28 }));
  return { trail: [], stars };
}

export function drawMission(ctx: CanvasRenderingContext2D, m: MissionState, mem: RenderMemory, fx: Fx, look: MissionLook, sizePx: number, dpr: number, t: number): void {
  const scale = sizePx / VIEW;
  const px = 1 / scale;
  const accent = m.def.accent;
  const chrono = m.chrono.active > 0 ? Math.min(1, m.chrono.active / 0.4, (CHRONO_DURATION - m.chrono.active) / 0.25 + 0.2) : 0;
  const shake = look.reducedMotion ? 0 : fx.shake;
  const ox = shake ? (Math.random() - 0.5) * shake : 0;
  const oy = shake ? (Math.random() - 0.5) * shake : 0;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, ox * dpr * scale, oy * dpr * scale);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, VIEW, VIEW);
  ctx.clip();

  drawSpace(ctx, m, mem, accent, t, chrono);

  ctx.save();
  ctx.translate(-m.camX, -m.camY);
  drawGrid(ctx, m, accent, t);
  drawCollapse(ctx, m, t);
  drawPulses(ctx, m);
  drawReactors(ctx, m, t);
  drawGates(ctx, m, t);
  drawPortal(ctx, m, t);
  drawWalls(ctx, m, accent, px);
  drawBarriers(ctx, m, t);
  drawCores(ctx, m, t);
  drawChronoPickup(ctx, m, t);
  drawRocks(ctx, m);
  drawBoss(ctx, m, t);
  drawDrones(ctx, m, t);
  drawBullets(ctx, m);
  drawTarget(ctx, m, t);
  updateTrail(mem, m);
  drawTrail(ctx, mem, m, look.trail, t);
  drawParticles(ctx, fx);
  if (m.status !== 'lost') drawShip(ctx, m, look.ship, t, chrono);
  drawPopups(ctx, fx);
  ctx.restore();
  drawPointer(ctx, m, t);

  // CHRONO SHIFT: cooler light over everything, with a vignette.
  if (chrono > 0) {
    ctx.fillStyle = `rgba(40, 120, 255, ${0.12 * chrono})`;
    ctx.fillRect(0, 0, VIEW, VIEW);
    const v = ctx.createRadialGradient(VIEW / 2, VIEW / 2, VIEW * 0.3, VIEW / 2, VIEW / 2, VIEW * 0.72);
    v.addColorStop(0, 'rgba(0, 0, 0, 0)');
    v.addColorStop(1, `rgba(20, 60, 160, ${0.45 * chrono})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, VIEW, VIEW);
  }
  if (fx.flash > 0) {
    ctx.fillStyle = rgba(RED, fx.flash * 0.25);
    ctx.fillRect(0, 0, VIEW, VIEW);
  }
  ctx.restore();

  // Frame
  ctx.lineWidth = 2 * px;
  ctx.strokeStyle = rgba(chrono > 0 ? [120, 190, 255] : accent, 0.55);
  ctx.shadowColor = rgba(accent, 0.7);
  ctx.shadowBlur = 16;
  ctx.strokeRect(px, px, VIEW - 2 * px, VIEW - 2 * px);
  ctx.shadowBlur = 0;
}

// ---------- Background ----------

function drawSpace(ctx: CanvasRenderingContext2D, m: MissionState, mem: RenderMemory, accent: RGB, t: number, chrono: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, VIEW);
  g.addColorStop(0, '#05060d');
  g.addColorStop(1, '#090611');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW, VIEW);
  // Nebula glow in the mission colour.
  const n = ctx.createRadialGradient(VIEW * 0.72 - m.camX * 0.05, VIEW * 0.26 - ((m.camY * 0.05) % 300), 30, VIEW * 0.72, VIEW * 0.26, VIEW * 0.62);
  n.addColorStop(0, rgba(accent, 0.12));
  n.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = n;
  ctx.fillRect(0, 0, VIEW, VIEW);
  const n2 = ctx.createRadialGradient(VIEW * 0.18, VIEW * 0.82, 20, VIEW * 0.18, VIEW * 0.82, VIEW * 0.52);
  n2.addColorStop(0, rgba(VIOLET, 0.08));
  n2.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = n2;
  ctx.fillRect(0, 0, VIEW, VIEW);
  // Parallax stars: far ones scroll slowly with the camera.
  for (const s of mem.stars) {
    const y = (((s.y - m.camY * s.z * 0.35) % VIEW) + VIEW) % VIEW;
    const x = (((s.x - m.camX * s.z * 0.35) % VIEW) + VIEW) % VIEW;
    const a = 0.25 + 0.5 * s.z * (0.7 + 0.3 * Math.sin(t * 2 + s.tw));
    ctx.fillStyle = chrono > 0 ? `rgba(160, 210, 255, ${a})` : `rgba(243, 240, 234, ${a})`;
    const r = 0.8 + s.z * 1.6;
    ctx.fillRect(x, y, r, r);
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, m: MissionState, accent: RGB, t: number): void {
  const top = m.camY;
  const bottom = m.camY + VIEW;
  const left = m.camX;
  const right = m.camX + VIEW;
  // Far grid (parallax, faint) gives depth under the near grid.
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(VIOLET, 0.06);
  const far = 80;
  const shiftFarY = (m.camY * 0.5) % far;
  const shiftFarX = (m.camX * 0.5) % far;
  ctx.beginPath();
  for (let x = left - shiftFarX; x <= right; x += far) {
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
  }
  for (let y = top - shiftFarY; y <= bottom; y += far) {
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
  }
  ctx.stroke();
  // Near grid with a slow energy pulse travelling along it.
  const step = 100;
  ctx.strokeStyle = rgba(accent, 0.1);
  ctx.beginPath();
  for (let x = 0; x <= m.def.world.w; x += step) {
    ctx.moveTo(x, Math.max(0, top));
    ctx.lineTo(x, Math.min(m.def.world.h, bottom));
  }
  for (let y = Math.floor(top / step) * step; y <= bottom; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(m.def.world.w, y);
  }
  ctx.stroke();
  const pulseY = m.def.world.h - ((t * 160) % (m.def.world.h + 200));
  const pg = ctx.createLinearGradient(0, pulseY - 60, 0, pulseY + 60);
  pg.addColorStop(0, 'rgba(0,0,0,0)');
  pg.addColorStop(0.5, rgba(accent, 0.07));
  pg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = pg;
  ctx.fillRect(0, pulseY - 60, m.def.world.w, 120);
  // World edges
  ctx.strokeStyle = rgba(accent, 0.35);
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, m.def.world.w - 3, m.def.world.h - 3);
}

// ---------- Structures and hazards ----------

function drawWalls(ctx: CanvasRenderingContext2D, m: MissionState, accent: RGB, px: number): void {
  for (const w0 of m.walls) {
    if (w0.move) {
      // Track the plate slides along.
      ctx.strokeStyle = rgba(accent, 0.18);
      ctx.setLineDash([6, 8]);
      ctx.lineWidth = 2;
      ctx.strokeRect(w0.x, w0.y, w0.w + w0.move.dx, w0.h + w0.move.dy);
      ctx.setLineDash([]);
    }
    const w = wallAt(w0, m.time);
    const g = ctx.createLinearGradient(w.x, w.y, w.x, w.y + w.h);
    g.addColorStop(0, 'rgba(30, 34, 58, 0.95)');
    g.addColorStop(1, 'rgba(14, 14, 26, 0.95)');
    ctx.fillStyle = g;
    ctx.fillRect(w.x, w.y, w.w, w.h);
    // Hazard hatching
    ctx.save();
    ctx.beginPath();
    ctx.rect(w.x, w.y, w.w, w.h);
    ctx.clip();
    ctx.strokeStyle = rgba(accent, 0.12);
    ctx.lineWidth = 3;
    for (let k = -w.h; k < w.w; k += 16) {
      ctx.beginPath();
      ctx.moveTo(w.x + k, w.y + w.h);
      ctx.lineTo(w.x + k + w.h, w.y);
      ctx.stroke();
    }
    ctx.restore();
    ctx.shadowColor = rgba(accent, 0.8);
    ctx.shadowBlur = 12;
    ctx.strokeStyle = rgba(accent, 0.85);
    ctx.lineWidth = 2.5 * Math.max(1, px);
    ctx.strokeRect(w.x, w.y, w.w, w.h);
    ctx.shadowBlur = 0;
  }
}

function drawBarriers(ctx: CanvasRenderingContext2D, m: MissionState, t: number): void {
  for (const b of m.barriers) {
    const st = barrierState(b, m.time);
    // Emitters at both ends
    for (const [x, y] of [
      [b.x1, b.y1],
      [b.x2, b.y2],
    ]) {
      ctx.fillStyle = rgba(st === 'off' ? VIOLET : MAGENTA, 0.9);
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    ctx.lineTo(b.x2, b.y2);
    if (st === 'on') {
      ctx.shadowColor = rgba(MAGENTA, 1);
      ctx.shadowBlur = 22;
      ctx.strokeStyle = rgba(MAGENTA, 0.95);
      ctx.lineWidth = 8 + Math.sin(t * 40) * 1.5;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = rgba(WHITE, 0.9);
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (st === 'warning') {
      // Flickers and dashes before switching on.
      ctx.setLineDash([14, 10]);
      ctx.strokeStyle = rgba(MAGENTA, Math.sin(t * 30) > 0 ? 0.75 : 0.25);
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.setLineDash([3, 12]);
      ctx.strokeStyle = rgba(VIOLET, 0.3);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function drawRocks(ctx: CanvasRenderingContext2D, m: MissionState): void {
  for (const r of m.rocks) {
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(m.time * (0.4 + r.spin * 0.3));
    ctx.beginPath();
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r.r * (0.82 + 0.18 * Math.sin(i * 2.7 + r.id));
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(40, 22, 18, 0.95)';
    ctx.fill();
    ctx.shadowColor = rgba(ORANGE, 0.9);
    ctx.shadowBlur = 12;
    ctx.strokeStyle = rgba(ORANGE, 0.95);
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}

function drawCollapse(ctx: CanvasRenderingContext2D, m: MissionState, t: number): void {
  if (m.collapseY === null) return;
  const y = m.collapseY;
  ctx.fillStyle = 'rgba(2, 1, 4, 0.96)';
  ctx.fillRect(0, y, m.def.world.w, m.def.world.h - y + 50);
  // Jagged burning edge
  ctx.beginPath();
  ctx.moveTo(0, y);
  for (let x = 0; x <= m.def.world.w; x += 25) ctx.lineTo(x, y + Math.sin(x * 0.07 + t * 6) * 8 + ((x * 13) % 11));
  ctx.lineTo(m.def.world.w, y + 60);
  ctx.lineTo(0, y + 60);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, y - 30, 0, y + 60);
  g.addColorStop(0, rgba(RED, 0));
  g.addColorStop(0.4, rgba(RED, 0.7));
  g.addColorStop(1, rgba(ORANGE, 0.1));
  ctx.fillStyle = g;
  ctx.fill();
  // Warning glow above the edge
  const w = ctx.createLinearGradient(0, y - 160, 0, y);
  w.addColorStop(0, 'rgba(0,0,0,0)');
  w.addColorStop(1, rgba(RED, 0.18));
  ctx.fillStyle = w;
  ctx.fillRect(0, y - 160, m.def.world.w, 160);
}

function drawPulses(ctx: CanvasRenderingContext2D, m: MissionState): void {
  for (const p of m.pulses) {
    ctx.save();
    if (p.warn > 0) {
      ctx.setLineDash([10, 10]);
      ctx.strokeStyle = rgba(ORANGE, 0.5);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(500, 500, 60 + (1.1 - p.warn) * 40, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Show where the gap will be, then the expanding band with its gap.
    const r = Math.max(30, p.r);
    ctx.beginPath();
    ctx.arc(500, 500, r, p.gap + PULSE_GAP, p.gap - PULSE_GAP + Math.PI * 2);
    ctx.strokeStyle = rgba(ORANGE, p.warn > 0 ? 0.25 : 0.85);
    ctx.lineWidth = p.warn > 0 ? 3 : PULSE_BAND * 2;
    ctx.shadowColor = rgba(ORANGE, 0.9);
    ctx.shadowBlur = p.warn > 0 ? 0 : 18;
    ctx.stroke();
    ctx.restore();
  }
  if (m.pulseEvery > 0) {
    // The overheating core
    const g = ctx.createRadialGradient(500, 500, 4, 500, 500, 60);
    g.addColorStop(0, rgba(GOLD, 0.9));
    g.addColorStop(1, rgba(ORANGE, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(500, 500, 60, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------- Objectives ----------

function drawCores(ctx: CanvasRenderingContext2D, m: MissionState, t: number): void {
  for (const c of m.cores) {
    if (c.taken) continue;
    const pulse = 1 + Math.sin(t * 4 + c.id) * 0.12;
    const halo = ctx.createRadialGradient(c.x, c.y, 2, c.x, c.y, 34 * pulse);
    halo.addColorStop(0, rgba(CYAN, 0.55));
    halo.addColorStop(1, rgba(CYAN, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 34 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(t * 1.6);
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(10, 0);
    ctx.lineTo(0, 14);
    ctx.lineTo(-10, 0);
    ctx.closePath();
    ctx.fillStyle = rgba([200, 255, 250], 0.95);
    ctx.shadowColor = rgba(CYAN, 1);
    ctx.shadowBlur = 16;
    ctx.fill();
    ctx.restore();
  }
}

function drawGates(ctx: CanvasRenderingContext2D, m: MissionState, t: number): void {
  const next = m.gates.find((g) => !g.passed);
  m.gates.forEach((g, i) => {
    const isNext = g === next;
    const col: RGB = g.passed ? [91, 240, 138] : isNext ? VIOLET : [90, 90, 120];
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.strokeStyle = rgba(col, isNext ? 0.95 : 0.5);
    ctx.lineWidth = isNext ? 5 : 3;
    ctx.shadowColor = rgba(col, 0.9);
    ctx.shadowBlur = isNext ? 20 : 6;
    for (let k = 0; k < 4; k++) {
      const a0 = t * (isNext ? 1.2 : 0.3) + (k * Math.PI) / 2;
      ctx.beginPath();
      ctx.arc(0, 0, g.r, a0, a0 + 1.1);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = rgba(col, 0.9);
    ctx.font = '700 20px Unbounded, Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(g.passed ? '✓' : String(i + 1), 0, 0);
    ctx.restore();
  });
}

function drawReactors(ctx: CanvasRenderingContext2D, m: MissionState, t: number): void {
  for (const r of m.reactors) {
    ctx.save();
    ctx.translate(r.x, r.y);
    const col: RGB = r.active ? GOLD : [140, 120, 70];
    // Hexagonal pad
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      if (i === 0) ctx.moveTo(Math.cos(a) * r.r, Math.sin(a) * r.r);
      else ctx.lineTo(Math.cos(a) * r.r, Math.sin(a) * r.r);
    }
    ctx.closePath();
    ctx.fillStyle = rgba(col, r.active ? 0.18 : 0.06);
    ctx.fill();
    ctx.strokeStyle = rgba(col, 0.8);
    ctx.lineWidth = 2;
    ctx.stroke();
    // Charge arc
    if (!r.active && r.charge > 0) {
      ctx.beginPath();
      ctx.arc(0, 0, r.r - 12, -Math.PI / 2, -Math.PI / 2 + r.charge * Math.PI * 2);
      ctx.strokeStyle = rgba(GOLD, 0.95);
      ctx.lineWidth = 6;
      ctx.shadowColor = rgba(GOLD, 1);
      ctx.shadowBlur = 14;
      ctx.stroke();
    }
    // Core
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
    g.addColorStop(0, rgba(r.active ? WHITE : GOLD, r.active ? 1 : 0.5 + 0.2 * Math.sin(t * 5)));
    g.addColorStop(1, rgba(GOLD, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawPortal(ctx: CanvasRenderingContext2D, m: MissionState, t: number): void {
  const p = m.portal;
  if (!p) return;
  ctx.save();
  ctx.translate(p.x, p.y);
  if (!p.open) {
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = 'rgba(160, 160, 190, 0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, p.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(160, 160, 190, 0.6)';
    ctx.font = '600 12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('LOCKED', 0, 4);
    ctx.restore();
    return;
  }
  // Vortex
  const g = ctx.createRadialGradient(0, 0, 4, 0, 0, p.r * 1.6);
  g.addColorStop(0, rgba(WHITE, 0.9));
  g.addColorStop(0.35, rgba(CYAN, 0.5));
  g.addColorStop(0.7, rgba(MAGENTA, 0.18));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, p.r * 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = rgba(CYAN, 1);
  ctx.shadowBlur = 20;
  for (let k = 0; k < 3; k++) {
    ctx.rotate(t * (1.2 + k * 0.6) * (k % 2 ? -1 : 1));
    ctx.strokeStyle = rgba(k === 1 ? MAGENTA : CYAN, 0.9);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, p.r - k * 9, 0, Math.PI * 1.4);
    ctx.stroke();
  }
  ctx.restore();
  // Beacon so the exit is easy to find
  const beam = ctx.createLinearGradient(p.x, p.y - 300, p.x, p.y);
  beam.addColorStop(0, 'rgba(0,0,0,0)');
  beam.addColorStop(1, rgba(CYAN, 0.2));
  ctx.fillStyle = beam;
  ctx.fillRect(p.x - 10, p.y - 300, 20, 300);
}

function drawChronoPickup(ctx: CanvasRenderingContext2D, m: MissionState, t: number): void {
  const c = m.chrono.pickup;
  if (!c) return;
  const fade = Math.min(1, c.life / 1.5);
  const blink = c.life < 2 && Math.floor(t * 8) % 2 === 0 ? 0.4 : 1;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.globalAlpha = fade * blink;
  // Distinct look: a clock ring with ticking hand, white-violet (never used by hazards or cores).
  const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, 46);
  halo.addColorStop(0, 'rgba(210, 200, 255, 0.6)');
  halo.addColorStop(1, 'rgba(155, 123, 255, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(230, 225, 255, 0.95)';
  ctx.lineWidth = 3;
  ctx.shadowColor = rgba(VIOLET, 1);
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(0, 0, 18, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 24, Math.sin(a) * 24);
    ctx.lineTo(Math.cos(a) * 28, Math.sin(a) * 28);
    ctx.stroke();
  }
  ctx.rotate(t * 2);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -13);
  ctx.stroke();
  ctx.restore();
}

// ---------- Enemies ----------

function drawDrones(ctx: CanvasRenderingContext2D, m: MissionState, t: number): void {
  for (const d of m.drones) {
    ctx.save();
    ctx.translate(d.x, d.y);
    if (d.spawnIn > 0) {
      // Warp-in ring
      ctx.strokeStyle = rgba(RED, 0.8 * (1 - d.spawnIn / 0.8));
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 40 * d.spawnIn + 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      continue;
    }
    const face = Math.atan2(m.ship.y - d.y, m.ship.x - d.x);
    const col: RGB = d.hitFlash > 0 ? WHITE : RED;
    ctx.shadowColor = rgba(RED, 0.9);
    ctx.shadowBlur = 14;
    if (d.kind === 'scout') {
      ctx.rotate(face);
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.lineTo(-12, 13);
      ctx.lineTo(-6, 0);
      ctx.lineTo(-12, -13);
      ctx.closePath();
      ctx.fillStyle = rgba(col, 0.95);
      ctx.fill();
    } else {
      ctx.rotate(t * 0.8);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        if (i === 0) ctx.moveTo(Math.cos(a) * 20, Math.sin(a) * 20);
        else ctx.lineTo(Math.cos(a) * 20, Math.sin(a) * 20);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(40, 10, 16, 0.95)';
      ctx.fill();
      ctx.strokeStyle = rgba(col, 0.95);
      ctx.lineWidth = 3;
      ctx.stroke();
      // Charging eye: grows and brightens before it fires
      const charge = d.aim > 0 ? 1 - d.aim / 0.6 : 0;
      ctx.fillStyle = rgba(d.aim > 0 ? ORANGE : RED, 0.6 + 0.4 * charge);
      ctx.beginPath();
      ctx.arc(0, 0, 5 + charge * 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    if (d.kind === 'gunner' && d.aim > 0) {
      // Aim line telegraph
      ctx.setLineDash([6, 8]);
      ctx.strokeStyle = rgba(ORANGE, 0.45);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(m.ship.x, m.ship.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Health pips
    if (d.hp < d.maxHp) {
      for (let i = 0; i < d.maxHp; i++) {
        ctx.fillStyle = i < d.hp ? rgba(RED, 0.9) : 'rgba(255,255,255,0.15)';
        ctx.fillRect(d.x - d.maxHp * 4 + i * 8, d.y - 32, 6, 3);
      }
    }
  }
}

function drawBoss(ctx: CanvasRenderingContext2D, m: MissionState, t: number): void {
  const b = m.boss;
  if (!b) return;
  if (b.dying > 0 || (m.status === 'won' && b.hp <= 0)) {
    const k = 1 - b.dying / 1.6;
    ctx.globalAlpha = Math.max(0, 1 - k);
  }
  // Beam
  if (b.beam) {
    const ex = b.x + Math.cos(b.beam.angle) * BEAM_LENGTH;
    const ey = b.y + Math.sin(b.beam.angle) * BEAM_LENGTH;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(ex, ey);
    if (b.beam.warn > 0) {
      ctx.setLineDash([16, 10]);
      ctx.strokeStyle = rgba(RED, Math.sin(t * 30) > 0 ? 0.8 : 0.35);
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.shadowColor = rgba(MAGENTA, 1);
      ctx.shadowBlur = 30;
      ctx.strokeStyle = rgba(MAGENTA, 0.85);
      ctx.lineWidth = BEAM_HALF * 2;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = rgba(WHITE, 0.95);
      ctx.lineWidth = 6;
      ctx.stroke();
    }
  }
  ctx.save();
  ctx.translate(b.x, b.y);
  // Outer rotating armour plates
  for (let i = 0; i < 6; i++) {
    ctx.save();
    ctx.rotate(t * 0.5 + (i / 6) * Math.PI * 2);
    ctx.translate(78, 0);
    ctx.beginPath();
    ctx.moveTo(-14, -22);
    ctx.lineTo(18, 0);
    ctx.lineTo(-14, 22);
    ctx.closePath();
    ctx.fillStyle = 'rgba(46, 14, 40, 0.95)';
    ctx.fill();
    ctx.strokeStyle = rgba(MAGENTA, 0.9);
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }
  // Body
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    if (i === 0) ctx.moveTo(Math.cos(a) * 62, Math.sin(a) * 62);
    else ctx.lineTo(Math.cos(a) * 62, Math.sin(a) * 62);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(24, 10, 30, 0.97)';
  ctx.fill();
  ctx.shadowColor = rgba(MAGENTA, 1);
  ctx.shadowBlur = 24;
  ctx.strokeStyle = rgba(b.hitFlash > 0 ? WHITE : MAGENTA, 0.95);
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.shadowBlur = 0;
  // Core: hidden behind a shield, or exposed and glowing
  if (b.shielded) {
    ctx.strokeStyle = rgba(CYAN, 0.55 + 0.2 * Math.sin(t * 6));
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 96, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = rgba(CYAN, 0.06);
    ctx.fill();
    ctx.fillStyle = rgba([120, 80, 140], 0.9);
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 40);
    g.addColorStop(0, rgba(WHITE, 1));
    g.addColorStop(0.4, rgba(MAGENTA, 0.9));
    g.addColorStop(1, rgba(MAGENTA, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 40 + Math.sin(t * 10) * 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawBullets(ctx: CanvasRenderingContext2D, m: MissionState): void {
  for (const b of m.bullets) {
    if (b.from === 'player') {
      const sp = Math.hypot(b.vx, b.vy) || 1;
      ctx.strokeStyle = rgba(CYAN, 0.95);
      ctx.shadowColor = rgba(CYAN, 1);
      ctx.shadowBlur = 10;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(b.x - (b.vx / sp) * 16, b.y - (b.vy / sp) * 16);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else {
      ctx.fillStyle = rgba(ORANGE, 0.95);
      ctx.shadowColor = rgba(ORANGE, 1);
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(WHITE, 0.9);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.shadowBlur = 0;
}

function drawTarget(ctx: CanvasRenderingContext2D, m: MissionState, t: number): void {
  if (m.target === null) return;
  const tg = m.target === -1 ? m.boss : m.drones.find((d) => d.id === m.target);
  if (!tg) return;
  const r = m.target === -1 ? 50 : 28;
  ctx.save();
  ctx.translate(tg.x, tg.y);
  ctx.rotate(t * 2);
  ctx.strokeStyle = rgba(CYAN, 0.85);
  ctx.lineWidth = 2;
  for (let k = 0; k < 4; k++) {
    ctx.beginPath();
    ctx.arc(0, 0, r, (k * Math.PI) / 2 + 0.2, (k * Math.PI) / 2 + 0.9);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------- Ship ----------

/** Hull outlines (pointing along +x). The hit circle is the central core (radius SHIP_R). */
export const HULLS: Record<ShipId, [number, number][]> = {
  arrow: [[26, 0], [-4, 7], [-16, 18], [-12, 4], [-12, -4], [-16, -18], [-4, -7]],
  interceptor: [[28, 0], [8, 6], [-6, 22], [-14, 22], [-8, 5], [-18, 0], [-8, -5], [-14, -22], [-6, -22], [8, -6]],
  manta: [[22, 0], [6, 10], [-10, 26], [-16, 18], [-12, 0], [-16, -18], [-10, -26], [6, -10]],
  phantom: [[30, 0], [4, 5], [-2, 16], [-20, 12], [-12, 0], [-20, -12], [-2, -16], [4, -5]],
};

function drawShip(ctx: CanvasRenderingContext2D, m: MissionState, ship: ShipId, t: number, chrono: number): void {
  const s = m.ship;
  const blink = s.invuln > 0 && m.status === 'playing' && Math.floor(t * 14) % 2 === 0;
  ctx.save();
  ctx.translate(s.x, s.y);
  if (chrono > 0) {
    // Energy field around the ship during CHRONO SHIFT
    ctx.strokeStyle = `rgba(150, 210, 255, ${0.5 * chrono})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 34 + Math.sin(t * 6) * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(150, 210, 255, ${0.25 * chrono})`;
    ctx.beginPath();
    ctx.arc(0, 0, 46 + Math.sin(t * 4) * 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.rotate(s.angle);
  // Banking: squash across the hull when turning hard
  const lateral = (-s.vx * Math.sin(s.angle) + s.vy * Math.cos(s.angle)) / 400;
  ctx.scale(1, 1 - Math.min(0.25, Math.abs(lateral) * 0.25));
  if (blink) ctx.globalAlpha = 0.35;
  // Engine flame
  const flame = 10 + s.thrust * 26 + Math.sin(t * 40) * 3;
  const fg = ctx.createLinearGradient(-12, 0, -12 - flame, 0);
  fg.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  fg.addColorStop(0.3, rgba(CYAN, 0.9));
  fg.addColorStop(1, rgba(MAGENTA, 0));
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(-10, -6);
  ctx.lineTo(-12 - flame, 0);
  ctx.lineTo(-10, 6);
  ctx.closePath();
  ctx.fill();
  // Hull
  const pts = HULLS[ship] ?? HULLS.arrow;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  const hg = ctx.createLinearGradient(-16, -20, 26, 20);
  hg.addColorStop(0, '#1b2440');
  hg.addColorStop(1, '#2c3a66');
  ctx.fillStyle = hg;
  ctx.shadowColor = rgba(CYAN, 0.9);
  ctx.shadowBlur = 18;
  ctx.fill();
  ctx.strokeStyle = rgba(ship === 'phantom' ? GOLD : CYAN, 0.95);
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.shadowBlur = 0;
  // Cockpit / energy core (the hit circle's centre)
  const cg = ctx.createRadialGradient(4, 0, 1, 4, 0, 8);
  cg.addColorStop(0, '#ffffff');
  cg.addColorStop(1, rgba(CYAN, 0.2));
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.ellipse(4, 0, 8, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function updateTrail(mem: RenderMemory, m: MissionState): void {
  const s = m.ship;
  const back = { x: s.x - Math.cos(s.angle) * 16, y: s.y - Math.sin(s.angle) * 16 };
  mem.trail.push({ ...back, t: m.realTime });
  while (mem.trail.length && m.realTime - mem.trail[0].t > 0.45) mem.trail.shift();
}

function drawTrail(ctx: CanvasRenderingContext2D, mem: RenderMemory, m: MissionState, style: string, t: number): void {
  const pts = mem.trail;
  if (pts.length < 2 || m.status === 'lost') return;
  ctx.lineCap = 'round';
  for (let i = 1; i < pts.length; i++) {
    const a = 1 - (m.realTime - pts[i].t) / 0.45;
    if (style === 'beads' && i % 2) continue;
    if (style === 'halo') {
      if (i % 3) continue;
      ctx.strokeStyle = rgba(GOLD, 0.5 * a);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, 3 + (1 - a) * 10, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }
    if (style === 'beads') {
      ctx.fillStyle = rgba(CYAN, 0.5 * a);
      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, 2 + 4 * a, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.strokeStyle = style === 'prism' ? `hsla(${(t * 120 + i * 14) % 360}, 90%, 65%, ${0.45 * a})` : rgba(style === 'comet' ? WHITE : CYAN, (style === 'comet' ? 0.5 : 0.3) * a);
    ctx.lineWidth = (style === 'comet' ? 12 : 7) * a;
    ctx.beginPath();
    ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
    ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
}

/** An arrow at the screen edge pointing to an off-screen objective. */
function drawPointer(ctx: CanvasRenderingContext2D, m: MissionState, t: number): void {
  if (m.status !== 'playing') return;
  const tg = objectiveTarget(m);
  if (!tg) return;
  const sx = tg.x - m.camX;
  const sy = tg.y - m.camY;
  const margin = 26;
  if (sx > margin && sx < VIEW - margin && sy > margin && sy < VIEW - margin) return;
  const cx = VIEW / 2;
  const cy = VIEW / 2;
  const a = Math.atan2(sy - cy, sx - cx);
  // Clamp along the ray to the screen edge.
  const k = Math.min(Math.abs((VIEW / 2 - margin) / (Math.cos(a) || 1e-6)), Math.abs((VIEW / 2 - margin) / (Math.sin(a) || 1e-6)));
  const px = cx + Math.cos(a) * k;
  const py = cy + Math.sin(a) * k;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(a);
  ctx.globalAlpha = 0.7 + 0.3 * Math.sin(t * 6);
  ctx.fillStyle = rgba(m.def.id === 'breach-protocol' || m.def.id === 'guardian' ? RED : CYAN, 0.95);
  ctx.shadowColor = ctx.fillStyle;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(-8, 10);
  ctx.lineTo(-3, 0);
  ctx.lineTo(-8, -10);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------- Effects ----------

function drawParticles(ctx: CanvasRenderingContext2D, fx: Fx): void {
  for (const rg of fx.rings) {
    if (rg.life > rg.max) continue;
    ctx.beginPath();
    ctx.arc(rg.x, rg.y, rg.r, 0, Math.PI * 2);
    ctx.strokeStyle = rg.color;
    ctx.globalAlpha = Math.max(0, rg.life / rg.max);
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  for (const pt of fx.particles) {
    const a = pt.life / pt.max;
    ctx.fillStyle = pt.color ?? (pt.accent ? rgba(ORANGE, a) : rgba(WHITE, a * 0.7));
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
    ctx.font = `700 ${pop.big ? 40 : 24}px Unbounded, Inter, sans-serif`;
    ctx.fillStyle = pop.big ? rgba(CYAN, a) : rgba(WHITE, a);
    ctx.fillText(pop.text, pop.x, pop.y);
  }
}
