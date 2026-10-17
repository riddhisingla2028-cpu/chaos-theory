// Canvas rendering for spacecraft missions. Everything is procedural (no image assets).
// Draws the world only; the HUD is React. Collision shapes in sim.ts match what is drawn here:
// the ship's hit circle is its central core, walls are exact rectangles, beams are exact lines.

import type { Fx } from '../game/fx';
import { Vfx } from './vfx';
import { BEAM_HALF, BEAM_LENGTH, CHRONO_DURATION, FIRE_RANGE, HIT_R, MUZZLE, PULSE_BAND, PULSE_GAP, VIEW, barrierState, objectiveTarget, wallAt, type Drone, type MissionState } from './sim';

export type ShipId = 'arrow' | 'interceptor' | 'manta' | 'phantom';

export interface MissionLook {
  ship: ShipId;
  trail: string; // TrailId from progression (classic, comet, beads, prism, halo)
  reducedMotion: boolean;
  aimAssist?: boolean;
}

type RGB = [number, number, number];
const rgba = (c: RGB, a: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
const CYAN: RGB = [76, 157, 255]; // electric blue: you and friendly systems
const MAGENTA: RGB = [255, 159, 64]; // amber: combat alerts and enemy energy
const VIOLET: RGB = [125, 150, 235]; // steel blue: navigation and gates
const ORANGE: RGB = [255, 140, 66];
const RED: RGB = [255, 72, 88];
const GOLD: RGB = [255, 213, 74];
const WHITE: RGB = [243, 240, 234];
const ALIEN: RGB = [176, 110, 255]; // alien raiders: bioluminescent violet, distinct from your blue and the red/amber of hazards
const FRIEND: RGB = [130, 205, 255]; // friendly IFF: pale blue

/** A soft additive-looking light: radial falloff to transparent. */
function bloom(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: RGB, a: number): void {
  if (r <= 0 || a <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(c, Math.min(1, a)));
  g.addColorStop(0.4, rgba(c, Math.min(1, a) * 0.35));
  g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** A flickering engine exhaust pointing along -x from (x, y). */
function engine(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, c: RGB, t: number, power: number): void {
  const len = w * (2.2 + power * 1.6) + Math.sin(t * 37) * w * 0.25;
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createLinearGradient(x, y, x - len, y);
  g.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  g.addColorStop(0.3, rgba(c, 0.8));
  g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x, y - w * 0.5);
  ctx.lineTo(x - len, y);
  ctx.lineTo(x, y + w * 0.5);
  ctx.closePath();
  ctx.fill();
  bloom(ctx, x, y, w * 1.4, c, 0.5);
  ctx.globalCompositeOperation = prev;
}

/** Per-run render memory: engine trail, star layers, the mission backdrop and pooled combat effects. */
export interface RenderMemory {
  trail: { x: number; y: number; t: number }[];
  stars: { x: number; y: number; z: number; tw: number }[];
  vfx: Vfx;
  lastT: number;
  backdrop: HTMLCanvasElement | null;
  backdropFor: string;
  /** Distant battle flashes on the far layer (screen space, parallax-free). */
  farFlashes: { x: number; y: number; life: number; max: number; big: boolean }[];
  nextFarFlash: number;
  /** > 0 for a moment after the player is hit (hull flashes white-red). */
  hurt: number;
  bossBlown: boolean;
}

export function createRenderMemory(seed: number): RenderMemory {
  let a = seed >>> 0 || 1;
  const rnd = () => {
    a = (Math.imul(a ^ (a >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return a / 4294967296;
  };
  const stars = Array.from({ length: 170 }, () => ({ x: rnd() * VIEW, y: rnd() * VIEW, z: 0.15 + rnd() * 0.85, tw: rnd() * 6.28 }));
  return { trail: [], stars, vfx: new Vfx(), lastT: -1, backdrop: null, backdropFor: '', farFlashes: [], nextFarFlash: 1.5, hurt: 0, bossBlown: false };
}

/** Each operation has its own sky: light colour, nebula tints, a distant body and how busy the far battle is. */
interface Env {
  sky: [string, string];
  neb: [RGB, RGB];
  body?: { x: number; y: number; r: number; c: RGB; ring?: boolean; glow?: RGB };
  sun: RGB; // key light tint for asteroids and hulls
  battle: number; // distant flashes per second
  silhouettes?: 'station' | 'fleet' | 'wreck' | 'hive';
}

const ENVS: Record<string, Env> = {
  'first-contact': { sky: ['#05070d', '#0b0a0c'], neb: [[150, 90, 50], [60, 80, 130]], body: { x: 0.82, y: 0.2, r: 0.16, c: [150, 110, 80] }, sun: [255, 200, 150], battle: 0 },
  'alien-pursuit': { sky: ['#06060e', '#0d0812'], neb: [[120, 70, 170], [200, 110, 40]], body: { x: 0.15, y: 0.15, r: 0.12, c: [90, 120, 90] }, sun: [230, 200, 255], battle: 0.35, silhouettes: 'hive' },
  rescue: { sky: ['#04080f', '#070b14'], neb: [[80, 140, 210], [140, 160, 190]], body: { x: 0.85, y: 0.78, r: 0.2, c: [150, 180, 210], ring: true }, sun: [200, 225, 255], battle: 0, silhouettes: 'wreck' },
  'shattered-orbit': { sky: ['#05060b', '#08090f'], neb: [[90, 100, 160], [60, 60, 90]], body: { x: 0.2, y: 0.85, r: 0.3, c: [100, 110, 140] }, sun: [210, 215, 240], battle: 0.1, silhouettes: 'station' },
  collapse: { sky: ['#07050a', '#140806'], neb: [[200, 80, 40], [120, 40, 30]], body: { x: 0.5, y: 1.25, r: 0.6, c: [200, 90, 50], glow: [255, 120, 60] }, sun: [255, 170, 120], battle: 0.15, silhouettes: 'station' },
  meltdown: { sky: ['#07060a', '#0e0b06'], neb: [[220, 170, 70], [90, 70, 40]], sun: [255, 220, 150], battle: 0 },
  'breach-protocol': { sky: ['#07050a', '#0e0608'], neb: [[170, 50, 50], [90, 60, 120]], body: { x: 0.8, y: 0.12, r: 0.1, c: [130, 70, 70] }, sun: [255, 180, 160], battle: 0.9, silhouettes: 'fleet' },
  convoy: { sky: ['#06070b', '#0d0b08'], neb: [[200, 160, 100], [80, 90, 120]], body: { x: 0.1, y: 0.3, r: 0.22, c: [190, 150, 100], ring: true }, sun: [255, 225, 180], battle: 0.5 },
  'last-jump': { sky: ['#03060d', '#060914'], neb: [[60, 110, 220], [150, 90, 60]], body: { x: 0.88, y: 0.1, r: 0.08, c: [160, 180, 220] }, sun: [190, 215, 255], battle: 1.1, silhouettes: 'fleet' },
  guardian: { sky: ['#050308', '#0b0408'], neb: [[160, 50, 70], [80, 50, 140]], sun: [255, 170, 170], battle: 0 },
};
const envOf = (m: MissionState): Env => ENVS[m.def.id] ?? ENVS['first-contact'];

export function drawMission(ctx: CanvasRenderingContext2D, m: MissionState, mem: RenderMemory, fx: Fx, look: MissionLook, sizePx: number, dpr: number, t: number): void {
  const scale = sizePx / VIEW;
  const px = 1 / scale;
  const accent = m.def.accent;
  const chrono = m.chrono.active > 0 ? Math.min(1, m.chrono.active / 0.4, (CHRONO_DURATION - m.chrono.active) / 0.25 + 0.2) : 0;
  const dt = mem.lastT < 0 ? 0 : Math.min(0.05, Math.max(0, t - mem.lastT));
  mem.lastT = t;
  mem.vfx.density = look.reducedMotion ? 0.35 : sizePx < 420 ? 0.7 : 1;
  mem.vfx.update(chrono > 0 ? dt * 0.4 : dt);
  mem.hurt = Math.max(0, mem.hurt - dt);
  // Capital-class destruction sequences start from state, so they also play after a resume.
  if (m.boss && m.boss.dying > 0 && !mem.bossBlown) {
    mem.bossBlown = true;
    mem.vfx.chain(m.boss.x, m.boss.y, 70, 7, 1.2, [255, 140, 70]);
  }
  const shake = look.reducedMotion ? 0 : Math.min(14, fx.shake);
  const ox = shake ? (Math.random() - 0.5) * shake : 0;
  const oy = shake ? (Math.random() - 0.5) * shake : 0;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, ox * dpr * scale, oy * dpr * scale);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, VIEW, VIEW);
  ctx.clip();

  drawSpace(ctx, m, mem, t, dt, chrono, look.reducedMotion);

  ctx.save();
  ctx.translate(-m.camX, -m.camY);
  drawGrid(ctx, m, accent);
  drawGravity(ctx, m, t);
  drawCollapse(ctx, m, t);
  drawPulses(ctx, m, t);
  drawReactors(ctx, m, t);
  drawGates(ctx, m, t);
  drawPortal(ctx, m, t);
  drawRescueZone(ctx, m, t);
  drawSwitches(ctx, m, t);
  drawWalls(ctx, m, accent, px, t);
  drawBarriers(ctx, m, t);
  drawCores(ctx, m, t);
  drawChronoPickup(ctx, m, t);
  drawPowerPickup(ctx, m, t);
  mem.vfx.drawUnder(ctx);
  drawPods(ctx, m, t);
  drawRocks(ctx, m, envOf(m));
  drawAllies(ctx, m, t);
  drawTethers(ctx, m, t);
  drawBoss(ctx, m, t);
  drawDrones(ctx, m, t);
  drawBullets(ctx, m);
  drawTarget(ctx, m, t);
  updateTrail(mem, m);
  drawTrail(ctx, mem, m, look.trail, t);
  drawParticles(ctx, fx);
  if (m.status === 'playing' && m.def.weapons) drawAim(ctx, m, t);
  if (m.status !== 'lost' || m.ship.hp > 0) drawShip(ctx, m, look.ship, t, chrono, mem.hurt);
  if (m.status === 'playing') drawShipStatus(ctx, m, t, look.reducedMotion);
  mem.vfx.drawOver(ctx);
  drawPopups(ctx, fx);
  ctx.restore();
  drawPointer(ctx, m, t);

  // CHRONO SHIFT: cooler, desaturated light over everything, with a vignette.
  if (chrono > 0) {
    ctx.fillStyle = `rgba(40, 110, 230, ${0.1 * chrono})`;
    ctx.fillRect(0, 0, VIEW, VIEW);
    const v = ctx.createRadialGradient(VIEW / 2, VIEW / 2, VIEW * 0.3, VIEW / 2, VIEW / 2, VIEW * 0.72);
    v.addColorStop(0, 'rgba(0, 0, 0, 0)');
    v.addColorStop(1, `rgba(20, 60, 160, ${0.45 * chrono})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, VIEW, VIEW);
  }
  // Cinematic vignette keeps the edges dark and the action central.
  const vg = ctx.createRadialGradient(VIEW / 2, VIEW / 2, VIEW * 0.42, VIEW / 2, VIEW / 2, VIEW * 0.78);
  vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vg.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, VIEW, VIEW);
  if (fx.flash > 0) {
    // Damage: red at the edges, not a full-screen wash
    const d = ctx.createRadialGradient(VIEW / 2, VIEW / 2, VIEW * 0.25, VIEW / 2, VIEW / 2, VIEW * 0.75);
    d.addColorStop(0, 'rgba(229, 72, 77, 0)');
    d.addColorStop(1, rgba(RED, Math.min(0.5, fx.flash * 0.45)));
    ctx.fillStyle = d;
    ctx.fillRect(0, 0, VIEW, VIEW);
  }
  ctx.restore();

  // Frame: a thin tactical border with corner brackets.
  const fc = chrono > 0 ? [120, 190, 255] as RGB : accent;
  ctx.lineWidth = 1.5 * px;
  ctx.strokeStyle = rgba(fc, 0.35);
  ctx.strokeRect(px, px, VIEW - 2 * px, VIEW - 2 * px);
  ctx.lineWidth = 3 * px;
  ctx.strokeStyle = rgba(fc, 0.85);
  const c = 26;
  for (const [x, y, sx, sy] of [[0, 0, 1, 1], [VIEW, 0, -1, 1], [VIEW, VIEW, -1, -1], [0, VIEW, 1, -1]] as const) {
    ctx.beginPath();
    ctx.moveTo(x + sx * 2 * px, y + sy * c);
    ctx.lineTo(x + sx * 2 * px, y + sy * 2 * px);
    ctx.lineTo(x + sx * c, y + sy * 2 * px);
    ctx.stroke();
  }
}

// ---------- Background ----------

/** Paints the static far layer once per mission: sky gradient, nebula clouds, a lit planet and silhouettes. */
function buildBackdrop(m: MissionState, env: Env): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const S = Math.round(VIEW * 1.3);
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  if (!g) return null;
  let a = 0;
  for (const ch of m.def.id) a = (a * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => {
    a = (Math.imul(a ^ (a >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return a / 4294967296;
  };
  const sky = g.createLinearGradient(0, 0, 0, S);
  sky.addColorStop(0, env.sky[0]);
  sky.addColorStop(1, env.sky[1]);
  g.fillStyle = sky;
  g.fillRect(0, 0, S, S);
  // Nebula: many soft overlapping blobs give cloud structure rather than one flat glow.
  for (let i = 0; i < 46; i++) {
    const col = i % 3 === 0 ? env.neb[1] : env.neb[0];
    const cx = S * (0.15 + 0.7 * rnd());
    const cy = S * (0.1 + 0.8 * rnd());
    const r = S * (0.08 + 0.22 * rnd());
    const n = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    n.addColorStop(0, rgba(col, 0.05 + 0.05 * rnd()));
    n.addColorStop(1, rgba(col, 0));
    g.fillStyle = n;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  // Dark dust lanes cut through the nebula
  g.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 6; i++) {
    const cx = S * rnd();
    const cy = S * rnd();
    const r = S * (0.1 + 0.15 * rnd());
    const n = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    n.addColorStop(0, 'rgba(20, 20, 30, 0.6)');
    n.addColorStop(1, 'rgba(255, 255, 255, 1)');
    g.fillStyle = n;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  g.globalCompositeOperation = 'source-over';
  // Faint fixed stars
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(220, 228, 245, ${0.08 + rnd() * 0.3})`;
    g.fillRect(rnd() * S, rnd() * S, 1, 1);
  }
  const b = env.body;
  if (b) {
    const bx = S * b.x;
    const by = S * b.y;
    const br = S * b.r;
    if (b.glow) {
      const atm = g.createRadialGradient(bx, by, br * 0.9, bx, by, br * 1.25);
      atm.addColorStop(0, rgba(b.glow, 0.5));
      atm.addColorStop(1, rgba(b.glow, 0));
      g.fillStyle = atm;
      g.beginPath();
      g.arc(bx, by, br * 1.25, 0, Math.PI * 2);
      g.fill();
    }
    // Lit sphere: key light from the upper left, dark terminator
    const pg = g.createRadialGradient(bx - br * 0.45, by - br * 0.45, br * 0.1, bx, by, br);
    pg.addColorStop(0, rgba(b.c, 0.85));
    pg.addColorStop(0.55, rgba(b.c.map((v) => v * 0.45) as RGB, 0.95));
    pg.addColorStop(1, 'rgba(6, 8, 14, 1)');
    g.fillStyle = pg;
    g.beginPath();
    g.arc(bx, by, br, 0, Math.PI * 2);
    g.fill();
    // Cloud bands
    g.save();
    g.beginPath();
    g.arc(bx, by, br, 0, Math.PI * 2);
    g.clip();
    for (let i = 0; i < 9; i++) {
      g.fillStyle = `rgba(0, 0, 0, ${0.05 + rnd() * 0.08})`;
      g.fillRect(bx - br, by - br + (i / 9) * br * 2, br * 2, br * (0.05 + rnd() * 0.1));
    }
    g.restore();
    // Rim light
    g.strokeStyle = rgba(env.sun, 0.25);
    g.lineWidth = 2;
    g.beginPath();
    g.arc(bx, by, br - 1, Math.PI * 0.95, Math.PI * 1.75);
    g.stroke();
    if (b.ring) {
      g.strokeStyle = rgba(b.c, 0.3);
      g.lineWidth = br * 0.06;
      g.beginPath();
      g.ellipse(bx, by, br * 1.8, br * 0.38, -0.28, 0, Math.PI * 2);
      g.stroke();
    }
  }
  // Distant silhouettes give each operation a sense of place
  // Far away and hazy: they must never read as obstacles or objectives
  g.globalAlpha = 0.5;
  g.fillStyle = 'rgba(16, 20, 32, 0.9)';
  g.strokeStyle = rgba(env.sun, 0.14);
  g.lineWidth = 1;
  const sil = env.silhouettes;
  if (sil === 'fleet') {
    for (let i = 0; i < 4; i++) {
      const x = S * (0.1 + 0.8 * rnd());
      const y = S * (0.08 + 0.3 * rnd());
      const L = S * (0.022 + 0.022 * rnd());
      g.beginPath();
      g.moveTo(x + L, y);
      g.lineTo(x - L * 0.2, y - L * 0.16);
      g.lineTo(x - L, y - L * 0.12);
      g.lineTo(x - L, y + L * 0.12);
      g.lineTo(x - L * 0.2, y + L * 0.16);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = 'rgba(140, 180, 255, 0.5)';
      g.fillRect(x - L * 1.05, y - 1, 3, 2);
      g.fillStyle = 'rgba(16, 20, 32, 0.9)';
    }
  } else if (sil === 'station' || sil === 'wreck') {
    const x = S * (sil === 'wreck' ? 0.25 : 0.7);
    const y = S * 0.28;
    const R = S * 0.045;
    g.save();
    g.translate(x, y);
    g.rotate(sil === 'wreck' ? 0.5 : 0.1);
    g.beginPath();
    g.arc(0, 0, R, sil === 'wreck' ? 0.4 : 0, sil === 'wreck' ? Math.PI * 1.5 : Math.PI * 2);
    g.lineWidth = R * 0.18;
    g.strokeStyle = 'rgba(14, 17, 28, 0.95)';
    g.stroke();
    g.lineWidth = 1;
    g.strokeStyle = rgba(env.sun, 0.2);
    g.stroke();
    g.fillRect(-R * 0.1, -R, R * 0.2, R * 2);
    g.fillRect(-R * 0.3, -R * 0.3, R * 0.6, R * 0.6);
    if (sil === 'station') {
      g.fillStyle = 'rgba(255, 190, 120, 0.6)';
      for (let i = 0; i < 6; i++) g.fillRect(Math.cos(i) * R - 1, Math.sin(i) * R - 1, 2, 2);
    }
    g.restore();
  } else if (sil === 'hive') {
    for (let i = 0; i < 18; i++) {
      const x = S * (0.55 + 0.4 * rnd());
      const y = S * (0.05 + 0.25 * rnd());
      g.fillStyle = 'rgba(160, 100, 230, 0.35)';
      g.fillRect(x, y, 2, 1);
    }
  }
  g.globalAlpha = 1;
  return c;
}

function drawSpace(ctx: CanvasRenderingContext2D, m: MissionState, mem: RenderMemory, t: number, dt: number, chrono: number, reduced: boolean): void {
  const env = envOf(m);
  if (mem.backdropFor !== m.def.id) {
    mem.backdrop = buildBackdrop(m, env);
    mem.backdropFor = m.def.id;
  }
  if (mem.backdrop) {
    // The far layer barely moves: the world scrolls past a distant sky.
    const spare = mem.backdrop.width - VIEW;
    const fx = Math.min(spare, Math.max(0, spare / 2 + (m.camX - (m.def.world.w - VIEW) / 2) * 0.04));
    const fy = Math.min(spare, Math.max(0, spare - m.camY * 0.04 - spare * 0.1));
    ctx.drawImage(mem.backdrop, -fx, -fy);
  } else {
    ctx.fillStyle = env.sky[0];
    ctx.fillRect(0, 0, VIEW, VIEW);
  }
  // Distant combat: brief flashes and tracer streaks on the far layer.
  if (env.battle > 0 && !reduced) {
    mem.nextFarFlash -= dt;
    if (mem.nextFarFlash <= 0) {
      mem.nextFarFlash = (0.4 + Math.random()) / env.battle;
      mem.farFlashes.push({ x: Math.random() * VIEW, y: Math.random() * VIEW * 0.55, life: 0.5, max: 0.5, big: Math.random() < 0.25 });
    }
    for (let i = mem.farFlashes.length - 1; i >= 0; i--) {
      const f = mem.farFlashes[i];
      f.life -= dt;
      if (f.life <= 0) {
        mem.farFlashes.splice(i, 1);
        continue;
      }
      const k = f.life / f.max;
      const r = f.big ? 22 : 9;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      g.addColorStop(0, `rgba(255, 210, 160, ${0.5 * k})`);
      g.addColorStop(1, 'rgba(255, 140, 60, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(f.x - r, f.y - r, r * 2, r * 2);
      if (!f.big) {
        ctx.strokeStyle = `rgba(140, 190, 255, ${0.35 * k})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(f.x - 30 * (1 - k), f.y + 6);
        ctx.lineTo(f.x - 30 * (1 - k) - 14, f.y + 9);
        ctx.stroke();
      }
    }
  }
  // Parallax star layers: near stars move faster and are brighter.
  for (const s of mem.stars) {
    const y = (((s.y - m.camY * s.z * 0.35) % VIEW) + VIEW) % VIEW;
    const x = (((s.x - m.camX * s.z * 0.35) % VIEW) + VIEW) % VIEW;
    const a = 0.2 + 0.55 * s.z * (0.75 + 0.25 * Math.sin(t * 2 + s.tw));
    ctx.fillStyle = chrono > 0 ? `rgba(160, 210, 255, ${a})` : s.z > 0.8 ? `rgba(255, 236, 214, ${a})` : `rgba(214, 226, 248, ${a})`;
    const r = 0.6 + s.z * 1.4;
    ctx.fillRect(x, y, r, r);
  }
  // Drifting dust motes close to the camera sell speed and depth
  if (!reduced) {
    ctx.fillStyle = rgba(env.sun, 0.07);
    for (let i = 0; i < 16; i++) {
      const sx = (i * 197.3) % VIEW;
      const sy = (i * 331.7) % VIEW;
      const x = (((sx - m.camX * 1.3) % VIEW) + VIEW) % VIEW;
      const y = (((sy - m.camY * 1.3) % VIEW) + VIEW) % VIEW;
      ctx.beginPath();
      ctx.arc(x, y, 1.5 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, m: MissionState, accent: RGB): void {
  // A faint tactical grid: navigation reference only, never competing with ships.
  const top = m.camY;
  const bottom = m.camY + VIEW;
  const step = 100;
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(120, 150, 210, 0.045)';
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
  // Grid crosses at intersections read as a targeting overlay
  ctx.strokeStyle = 'rgba(150, 180, 230, 0.12)';
  ctx.beginPath();
  for (let x = 0; x <= m.def.world.w; x += step * 2) {
    for (let y = Math.floor(top / (step * 2)) * step * 2; y <= bottom; y += step * 2) {
      ctx.moveTo(x - 4, y);
      ctx.lineTo(x + 4, y);
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x, y + 4);
    }
  }
  ctx.stroke();
  // World edges: a hazard boundary
  ctx.strokeStyle = rgba(accent, 0.3);
  ctx.lineWidth = 2;
  ctx.setLineDash([18, 12]);
  ctx.strokeRect(1.5, 1.5, m.def.world.w - 3, m.def.world.h - 3);
  ctx.setLineDash([]);
}

// ---------- Structures and hazards ----------

function drawWalls(ctx: CanvasRenderingContext2D, m: MissionState, accent: RGB, px: number, t: number): void {
  for (const w0 of m.walls) {
    if (w0.move) {
      // Rail the plate slides along.
      ctx.strokeStyle = rgba(accent, 0.16);
      ctx.setLineDash([6, 8]);
      ctx.lineWidth = 2;
      ctx.strokeRect(w0.x, w0.y, w0.w + w0.move.dx, w0.h + w0.move.dy);
      ctx.setLineDash([]);
    }
    const w = wallAt(w0, m.time);
    if (m.switches.some((sw) => sw.door === w0)) {
      drawDoor(ctx, w, t);
      continue;
    }
    // Gunmetal armour plating, lit from above
    const g = ctx.createLinearGradient(w.x, w.y, w.x, w.y + w.h);
    g.addColorStop(0, '#2a3142');
    g.addColorStop(0.5, '#1a1f2c');
    g.addColorStop(1, '#10131c');
    ctx.fillStyle = g;
    ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(w.x, w.y, w.w, w.h);
    ctx.clip();
    // Panel seams
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = w.x + 46; x < w.x + w.w; x += 46) {
      ctx.moveTo(x, w.y);
      ctx.lineTo(x, w.y + w.h);
    }
    if (w.h > 40) {
      ctx.moveTo(w.x, w.y + w.h / 2);
      ctx.lineTo(w.x + w.w, w.y + w.h / 2);
    }
    ctx.stroke();
    // Amber hazard stripes along the long edges
    const horiz = w.w >= w.h;
    ctx.fillStyle = 'rgba(255, 159, 64, 0.55)';
    if (horiz) {
      for (let k = w.x - 10; k < w.x + w.w; k += 18) {
        ctx.beginPath();
        ctx.moveTo(k, w.y);
        ctx.lineTo(k + 8, w.y);
        ctx.lineTo(k + 14, w.y + 6);
        ctx.lineTo(k + 6, w.y + 6);
        ctx.fill();
      }
    } else {
      for (let k = w.y - 10; k < w.y + w.h; k += 18) {
        ctx.beginPath();
        ctx.moveTo(w.x, k);
        ctx.lineTo(w.x, k + 8);
        ctx.lineTo(w.x + 6, k + 14);
        ctx.lineTo(w.x + 6, k + 6);
        ctx.fill();
      }
    }
    // Top highlight
    ctx.fillStyle = 'rgba(200, 215, 240, 0.12)';
    ctx.fillRect(w.x, w.y, w.w, 2);
    ctx.restore();
    ctx.strokeStyle = rgba(accent, 0.7);
    ctx.lineWidth = 1.6 * Math.max(1, px);
    ctx.strokeRect(w.x, w.y, w.w, w.h);
    // Blinking marker lights at the corners
    if (Math.floor(t * 1.5 + w.x * 0.01) % 2 === 0) {
      ctx.fillStyle = 'rgba(255, 90, 80, 0.95)';
      ctx.fillRect(w.x + 3, w.y + 3, 3, 3);
      ctx.fillRect(w.x + w.w - 6, w.y + w.h - 6, 3, 3);
    }
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

function drawRocks(ctx: CanvasRenderingContext2D, m: MissionState, env: Env): void {
  const sun = env.sun;
  for (const r of m.rocks) {
    ctx.save();
    ctx.translate(r.x, r.y);
    const rot = m.time * (0.4 + r.spin * 0.3);
    // Shape and craters rotate; lighting stays fixed (key light from the upper left).
    ctx.save();
    ctx.rotate(rot);
    ctx.beginPath();
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r.r * (0.8 + 0.2 * Math.sin(i * 2.7 + r.id) + 0.06 * Math.cos(i * 5.1 + r.id * 3));
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.restore();
    const g = ctx.createRadialGradient(-r.r * 0.45, -r.r * 0.45, r.r * 0.1, 0, 0, r.r * 1.1);
    g.addColorStop(0, `rgb(${92 + sun[0] * 0.12}, ${80 + sun[1] * 0.1}, ${72 + sun[2] * 0.08})`);
    g.addColorStop(0.6, '#2b2724');
    g.addColorStop(1, '#0d0c0d');
    ctx.fillStyle = g;
    ctx.fill();
    // Hazard rim: a thin hot edge on the lit side keeps rocks readable as dangerous
    ctx.strokeStyle = rgba(ORANGE, 0.55);
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.rotate(rot);
    // Craters
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
    for (let k = 0; k < (r.r > 30 ? 3 : 2); k++) {
      const a = r.id * 1.7 + k * 2.2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r.r * 0.42, Math.sin(a) * r.r * 0.42, r.r * (0.12 + 0.06 * k), 0, Math.PI * 2);
      ctx.fill();
    }
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

function drawPulses(ctx: CanvasRenderingContext2D, m: MissionState, t: number): void {
  for (const p of m.pulses) {
    ctx.save();
    if (p.warn > 0) {
      // Telegraph: the core flares and a dashed ring shows the coming wave and its safe gap
      ctx.setLineDash([10, 10]);
      ctx.strokeStyle = rgba(ORANGE, Math.sin(t * 24) > 0 ? 0.75 : 0.35);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(500, 500, 60 + (1.1 - p.warn) * 40, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(140, 200, 255, 0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(500, 500, 110, p.gap - PULSE_GAP, p.gap + PULSE_GAP);
      ctx.stroke();
    }
    const r = Math.max(30, p.r);
    ctx.beginPath();
    ctx.arc(500, 500, r, p.gap + PULSE_GAP, p.gap - PULSE_GAP + Math.PI * 2);
    if (p.warn > 0) {
      ctx.strokeStyle = rgba(ORANGE, 0.25);
      ctx.lineWidth = 3;
      ctx.stroke();
    } else {
      // Plasma wavefront: a wide soft band with a white-hot leading edge
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(ORANGE, 0.35);
      ctx.lineWidth = PULSE_BAND * 2.6;
      ctx.stroke();
      ctx.strokeStyle = rgba(GOLD, 0.7);
      ctx.lineWidth = PULSE_BAND * 1.2;
      ctx.stroke();
      ctx.strokeStyle = rgba(WHITE, 0.8);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }
  if (m.pulseEvery > 0) {
    // The overheating core: a containment ring around a bright, unstable heart
    const flicker = 0.85 + 0.15 * Math.sin(t * 13);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(500, 500, 4, 500, 500, 90);
    g.addColorStop(0, rgba(WHITE, 0.9 * flicker));
    g.addColorStop(0.25, rgba(GOLD, 0.6 * flicker));
    g.addColorStop(1, rgba(ORANGE, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(500, 500, 90, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(60, 66, 84, 0.95)';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(500, 500, 44, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = rgba(GOLD, 0.6);
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + t * 0.3;
      ctx.beginPath();
      ctx.arc(500, 500, 44, a, a + 0.4);
      ctx.stroke();
    }
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
    ctx.font = '700 20px Rajdhani, Inter, sans-serif';
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
  halo.addColorStop(1, 'rgba(125, 150, 235, 0)');
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
      // Warp-in: a contracting ring and a spike of light where the ship will appear
      const k = 1 - d.spawnIn / 0.8;
      ctx.strokeStyle = rgba(RED, 0.8 * k);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 40 * d.spawnIn + 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = rgba(WHITE, 0.6 * k);
      ctx.fillRect(-1, -14 * k, 2, 28 * k);
      ctx.fillRect(-14 * k, -1, 28 * k, 2);
      ctx.restore();
      continue;
    }
    const prey = (d.targetAlly !== null && m.allies.find((a) => a.id === d.targetAlly && !a.destroyed)) || m.ship;
    const face = Math.atan2(prey.y - d.y, prey.x - d.x);
    const flash = d.hitFlash > 0;
    const glow: RGB = d.kind === 'raider' ? ALIEN : RED;
    const charge = d.aim > 0 ? 1 - d.aim / 0.6 : 0;
    if (d.kind === 'raider') {
      // Alien raider: an organic swept crescent with a pulsing bioluminescent heart
      ctx.rotate(Math.atan2(d.vy, d.vx) || face);
      engine(ctx, -10, 0, 8, ALIEN, t, 0.8);
      ctx.beginPath();
      ctx.moveTo(22, 0);
      ctx.quadraticCurveTo(-2, 5, -16, 20);
      ctx.quadraticCurveTo(-6, 5, -10, 0);
      ctx.quadraticCurveTo(-6, -5, -16, -20);
      ctx.quadraticCurveTo(-2, -5, 22, 0);
      ctx.closePath();
      const g = ctx.createLinearGradient(-16, -20, 20, 20);
      g.addColorStop(0, '#1d1028');
      g.addColorStop(1, '#3a2050');
      ctx.fillStyle = flash ? '#f3f0ea' : g;
      ctx.fill();
      ctx.strokeStyle = rgba(ALIEN, 0.85);
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.strokeStyle = rgba(ALIEN, 0.35);
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.quadraticCurveTo(-4, 3, -12, 14);
      ctx.moveTo(14, 0);
      ctx.quadraticCurveTo(-4, -3, -12, -14);
      ctx.stroke();
      bloom(ctx, 3, 0, 9, ALIEN, 0.7 + 0.3 * Math.sin(t * 7 + d.id));
    } else if (d.kind === 'turret') {
      // Defence turret: an armoured octagonal emplacement with a tracking twin barrel
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        if (i === 0) ctx.moveTo(Math.cos(a) * 25, Math.sin(a) * 25);
        else ctx.lineTo(Math.cos(a) * 25, Math.sin(a) * 25);
      }
      ctx.closePath();
      const g = ctx.createRadialGradient(-8, -8, 2, 0, 0, 26);
      g.addColorStop(0, '#3b4252');
      g.addColorStop(1, '#151820');
      ctx.fillStyle = flash ? '#f3f0ea' : g;
      ctx.fill();
      ctx.strokeStyle = rgba(RED, 0.75);
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.rotate(Math.atan2(m.ship.y - d.y, m.ship.x - d.x));
      ctx.fillStyle = '#4a5162';
      ctx.fillRect(4, -7, 28, 5);
      ctx.fillRect(4, 2, 28, 5);
      ctx.fillStyle = '#2a2f3b';
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.fill();
      bloom(ctx, 0, 0, 8 + charge * 14, charge > 0 ? ORANGE : RED, 0.55 + 0.45 * charge);
      if (charge > 0) bloom(ctx, 32, 0, 6 + charge * 10, GOLD, charge);
    } else if (d.kind === 'scout') {
      // Interceptor: a narrow dart with forward-swept canards and twin engines
      ctx.rotate(face);
      engine(ctx, -12, -5, 6, ORANGE, t, 0.9);
      engine(ctx, -12, 5, 6, ORANGE, t + 0.3, 0.9);
      ctx.beginPath();
      ctx.moveTo(20, 0);
      ctx.lineTo(4, -4);
      ctx.lineTo(-2, -15);
      ctx.lineTo(-8, -15);
      ctx.lineTo(-6, -5);
      ctx.lineTo(-13, -4);
      ctx.lineTo(-13, 4);
      ctx.lineTo(-6, 5);
      ctx.lineTo(-8, 15);
      ctx.lineTo(-2, 15);
      ctx.lineTo(4, 4);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, -15, 0, 15);
      g.addColorStop(0, '#454c5c');
      g.addColorStop(1, '#1c2029');
      ctx.fillStyle = flash ? '#f3f0ea' : g;
      ctx.fill();
      ctx.strokeStyle = rgba(RED, 0.8);
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = rgba(RED, 0.95);
      ctx.fillRect(-2, -14, 3, 3);
      ctx.fillRect(-2, 11, 3, 3);
      bloom(ctx, 8, 0, 6, RED, 0.8);
    } else if (d.kind === 'generator') {
      drawGenerator(ctx, d, t, flash);
    } else if (d.kind === 'hive') {
      drawHive(ctx, d, t, flash);
    } else if (d.kind === 'commander') {
      drawCommander(ctx, d, t, flash);
    } else {
      // Gunship: a heavy wedge with armoured nacelles and a spinal plasma cannon that charges before it fires
      ctx.rotate(face);
      engine(ctx, -18, -11, 8, ORANGE, t, 1);
      engine(ctx, -18, 11, 8, ORANGE, t + 0.5, 1);
      ctx.beginPath();
      ctx.moveTo(22, 0);
      ctx.lineTo(10, -8);
      ctx.lineTo(-4, -10);
      ctx.lineTo(-10, -20);
      ctx.lineTo(-20, -18);
      ctx.lineTo(-18, -6);
      ctx.lineTo(-14, 0);
      ctx.lineTo(-18, 6);
      ctx.lineTo(-20, 18);
      ctx.lineTo(-10, 20);
      ctx.lineTo(-4, 10);
      ctx.lineTo(10, 8);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, -20, 0, 20);
      g.addColorStop(0, '#4a4f5c');
      g.addColorStop(0.5, '#2b2f3a');
      g.addColorStop(1, '#171a22');
      ctx.fillStyle = flash ? '#f3f0ea' : g;
      ctx.fill();
      ctx.strokeStyle = rgba(RED, 0.8);
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-4, -10);
      ctx.lineTo(-4, 10);
      ctx.stroke();
      bloom(ctx, 4, 0, 7 + charge * 16, charge > 0 ? ORANGE : RED, 0.6 + 0.4 * charge);
      if (charge > 0.4) bloom(ctx, 24, 0, 4 + charge * 12, GOLD, charge);
    }
    ctx.restore();
    if ((d.kind === 'gunner' || d.kind === 'turret') && d.aim > 0) {
      // Aim telegraph: dashed while charging, solid and bright just before the shot
      const aimAt = d.kind === 'turret' ? m.ship : prey;
      const late = charge > 0.7;
      ctx.setLineDash(late ? [] : [6, 8]);
      ctx.strokeStyle = rgba(late ? GOLD : ORANGE, late ? 0.7 : 0.4);
      ctx.lineWidth = late ? 1.5 : 2;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(aimAt.x, aimAt.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const big = d.kind === 'hive' || d.kind === 'commander' || d.kind === 'generator';
    if (big) {
      // Objective targets get a hull bar and a priority label
      const bw = d.kind === 'hive' ? 110 : 60;
      const by = d.y - HIT_R[d.kind] - 18;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(d.x - bw / 2, by, bw, 4);
      ctx.fillStyle = rgba(d.kind === 'generator' ? CYAN : RED, 0.95);
      ctx.fillRect(d.x - bw / 2, by, (bw * Math.max(0, d.hp)) / d.maxHp, 4);
      if (d.tag && d.kind !== 'generator') {
        ctx.fillStyle = rgba(ORANGE, 0.95);
        ctx.font = '600 11px "Share Tech Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(d.kind === 'hive' ? 'PRIORITY · HIVE CARRIER' : 'PRIORITY · COMMAND RAIDER', d.x, by - 6);
      }
    } else if (d.tag && d.tag !== 'brood') {
      // Members of an objective group (ambush, bombers, boarders): a small amber chevron
      ctx.fillStyle = rgba(ORANGE, 0.9);
      ctx.beginPath();
      ctx.moveTo(d.x - 6, d.y - 36);
      ctx.lineTo(d.x + 6, d.y - 36);
      ctx.lineTo(d.x, d.y - 29);
      ctx.closePath();
      ctx.fill();
    }
    if (!big && d.hp < d.maxHp) {
      // Hull pips
      for (let i = 0; i < d.maxHp; i++) {
        ctx.fillStyle = i < d.hp ? rgba(glow, 0.9) : 'rgba(255,255,255,0.15)';
        ctx.fillRect(d.x - d.maxHp * 4 + i * 8, d.y - 32, 6, 3);
      }
    }
  }
}

function drawBoss(ctx: CanvasRenderingContext2D, m: MissionState, t: number): void {
  const b = m.boss;
  if (!b) return;
  const dying = b.dying > 0 || (m.status === 'won' && b.hp <= 0);
  if (dying) {
    const k = 1 - b.dying / 1.6;
    ctx.globalAlpha = Math.max(0, 1 - k * 1.2);
  }
  // Beam
  if (b.beam) {
    const ex = b.x + Math.cos(b.beam.angle) * BEAM_LENGTH;
    const ey = b.y + Math.sin(b.beam.angle) * BEAM_LENGTH;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(ex, ey);
    if (b.beam.warn > 0) {
      // Telegraph: the exact width of the coming beam, flickering, plus a charge at the emitter
      const k = 1 - b.beam.warn / 1.1;
      ctx.strokeStyle = rgba(RED, 0.08 + 0.1 * k);
      ctx.lineWidth = BEAM_HALF * 2;
      ctx.stroke();
      ctx.setLineDash([16, 10]);
      ctx.strokeStyle = rgba(RED, Math.sin(t * 30) > 0 ? 0.85 : 0.35);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      bloom(ctx, b.x, b.y, 30 + k * 60, ORANGE, 0.5 + 0.5 * k);
      ctx.restore();
    } else {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(ORANGE, 0.35);
      ctx.lineWidth = BEAM_HALF * 2.6;
      ctx.stroke();
      ctx.strokeStyle = rgba(GOLD, 0.8);
      ctx.lineWidth = BEAM_HALF * 1.6;
      ctx.stroke();
      ctx.strokeStyle = rgba(WHITE, 0.95);
      ctx.lineWidth = 6 + Math.sin(t * 50) * 2;
      ctx.stroke();
      bloom(ctx, ex, ey, 40, ORANGE, 0.8);
      ctx.restore();
    }
  }
  ctx.save();
  ctx.translate(b.x, b.y);
  // Entrance: the Guardian warps in over its first three seconds, behind contracting warning rings.
  if (m.def.id === 'guardian' && m.time < 3 && b.hp > 0) {
    const k = Math.min(1, m.time / 2.4);
    ctx.strokeStyle = rgba(RED, 0.8 * (1 - k));
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, 60 + (1 - k) * (180 + i * 60), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    bloom(ctx, 0, 0, 160 * (1 - k) + 40, [255, 120, 80], 0.6 * (1 - k * 0.7));
    ctx.restore();
    ctx.scale(0.35 + 0.65 * k, 0.35 + 0.65 * k);
    ctx.globalAlpha = Math.max(0.15, k);
  }
  // Outer rotating armour plates: gunmetal with glowing seams
  for (let i = 0; i < 6; i++) {
    ctx.save();
    ctx.rotate(t * 0.5 + (i / 6) * Math.PI * 2);
    ctx.translate(80, 0);
    ctx.beginPath();
    ctx.moveTo(-16, -24);
    ctx.lineTo(20, -6);
    ctx.lineTo(20, 6);
    ctx.lineTo(-16, 24);
    ctx.lineTo(-10, 0);
    ctx.closePath();
    const g = ctx.createLinearGradient(-16, -24, 20, 24);
    g.addColorStop(0, '#4d5160');
    g.addColorStop(1, '#1a1c25');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = rgba(ORANGE, 0.7);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = rgba(RED, 0.9);
    ctx.fillRect(14, -2, 4, 4);
    ctx.restore();
  }
  // Body: a heavy octagonal hull with radial ribs
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    if (i === 0) ctx.moveTo(Math.cos(a) * 62, Math.sin(a) * 62);
    else ctx.lineTo(Math.cos(a) * 62, Math.sin(a) * 62);
  }
  ctx.closePath();
  const hb = ctx.createRadialGradient(-20, -24, 6, 0, 0, 66);
  hb.addColorStop(0, '#3c3f4c');
  hb.addColorStop(1, '#12131a');
  ctx.fillStyle = hb;
  ctx.fill();
  if (b.hitFlash > 0) {
    ctx.fillStyle = 'rgba(255, 220, 190, 0.18)';
    ctx.fill();
  }
  ctx.strokeStyle = rgba(b.hitFlash > 0 ? GOLD : RED, 0.85);
  ctx.lineWidth = b.hitFlash > 0 ? 3.5 : 2.5;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 26, Math.sin(a) * 26);
    ctx.lineTo(Math.cos(a) * 58, Math.sin(a) * 58);
    ctx.stroke();
  }
  // Core: hidden behind a shield, or exposed and glowing
  if (b.shielded) {
    ctx.strokeStyle = rgba(CYAN, 0.5 + 0.2 * Math.sin(t * 6));
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, 96, 0, Math.PI * 2);
    ctx.stroke();
    // Hex shimmer on the shield
    ctx.strokeStyle = rgba(CYAN, 0.12);
    ctx.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + t * 0.2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 86, Math.sin(a) * 86, 12, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(76, 157, 255, 0.05)';
    ctx.beginPath();
    ctx.arc(0, 0, 96, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a1e24';
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, Math.PI * 2);
    ctx.fill();
    bloom(ctx, 0, 0, 22, RED, 0.35);
  } else {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    bloom(ctx, 0, 0, 48 + Math.sin(t * 10) * 5, ORANGE, 1);
    bloom(ctx, 0, 0, 18, WHITE, 1);
    ctx.restore();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawBullets(ctx: CanvasRenderingContext2D, m: MissionState): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const b of m.bullets) {
    const sp = Math.hypot(b.vx, b.vy) || 1;
    const ux = b.vx / sp;
    const uy = b.vy / sp;
    if (b.from === 'player') {
      // Laser bolt: a soft blue sheath, a bright core and a white-hot tip
      ctx.strokeStyle = rgba(CYAN, 0.35);
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(b.x - ux * 30, b.y - uy * 30);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.strokeStyle = rgba([140, 200, 255], 0.95);
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(b.x - ux * 14, b.y - uy * 14);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else {
      // Plasma bolt: an amber orb with a fading tail along its path
      const tail = ctx.createLinearGradient(b.x, b.y, b.x - ux * 34, b.y - uy * 34);
      tail.addColorStop(0, rgba(ORANGE, 0.7));
      tail.addColorStop(1, rgba(ORANGE, 0));
      ctx.strokeStyle = tail;
      ctx.lineWidth = b.r * 1.6;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - ux * 34, b.y - uy * 34);
      ctx.stroke();
      bloom(ctx, b.x, b.y, b.r * 2.6, ORANGE, 0.9);
      ctx.fillStyle = rgba(WHITE, 0.95);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawTarget(ctx: CanvasRenderingContext2D, m: MissionState, t: number): void {
  if (m.target === null) return;
  // Hostile lock: amber corner brackets that tighten as they lock (rocks for The Rescue use their id).
  const tg = m.target === -1 ? m.boss : m.target <= -2 ? m.rocks.find((r) => -2 - r.id === m.target) : m.drones.find((d) => d.id === m.target);
  if (!tg) return;
  const hitR = m.target === -1 ? 70 : m.target <= -2 ? ('r' in tg ? (tg as { r: number }).r + 6 : 26) : HIT_R[(tg as Drone).kind] + 6;
  const r = hitR + Math.sin(t * 8) * 2;
  const L = r * 0.45;
  ctx.save();
  ctx.translate(tg.x, tg.y);
  ctx.strokeStyle = rgba(MAGENTA, 0.95);
  ctx.lineWidth = 2;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    ctx.beginPath();
    ctx.moveTo(sx * r, sy * (r - L));
    ctx.lineTo(sx * r, sy * r);
    ctx.lineTo(sx * (r - L), sy * r);
    ctx.stroke();
  }
  ctx.fillStyle = rgba(MAGENTA, 0.9);
  ctx.fillRect(-1.5, -1.5, 3, 3);
  ctx.restore();
}

// ---------- Friendly ships, pods, pickups, the singularity ----------

/** Friendly ships have distinct silhouettes and a hull bar; they flash when hit and burn when low. */
/** Friendly ships have distinct silhouettes and a hull bar; they flash when hit and burn when low. */
function drawAllies(ctx: CanvasRenderingContext2D, m: MissionState, t: number): void {
  for (const a of m.allies) {
    if (a.destroyed) continue;
    const wp = a.path[a.pathIdx];
    const ang = wp ? Math.atan2(wp.y - a.y, wp.x - a.x) : -Math.PI / 2;
    const low = a.hp / a.maxHp < 0.35;
    const flash = a.hitFlash > 0;
    ctx.save();
    ctx.translate(a.x, a.y);
    // Jump drive charge ring (The Last Jump)
    if (m.jump && a.kind === 'capital') {
      const k = m.jump.charge / m.jump.duration;
      ctx.strokeStyle = rgba(VIOLET, 0.2);
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, 0, a.r + 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = rgba(CYAN, 0.9);
      ctx.beginPath();
      ctx.arc(0, 0, a.r + 22, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
      ctx.stroke();
    }
    ctx.rotate(ang);
    const L = a.r * 1.25;
    const W = a.r * (a.kind === 'capital' ? 1.15 : a.kind === 'cargo' ? 0.7 : 0.55);
    // Engines
    const nE = a.kind === 'capital' ? 3 : 2;
    for (let k = 0; k < nE; k++) {
      const ey = nE === 3 ? (k - 1) * W * 0.4 : (k - 0.5) * W * 0.5;
      engine(ctx, -L * 0.9, ey, W * 0.22, FRIEND, t + k * 0.4, 1.1);
    }
    ctx.beginPath();
    if (a.kind === 'cargo') {
      // A hauler: armoured cab and a spine of containers
      ctx.rect(-L * 0.9, -W * 0.5, L * 1.3, W);
      ctx.moveTo(L * 0.4, -W * 0.38);
      ctx.lineTo(L * 0.85, -W * 0.15);
      ctx.lineTo(L * 0.85, W * 0.15);
      ctx.lineTo(L * 0.4, W * 0.38);
    } else if (a.kind === 'capital') {
      // A long wedge with flanking hangars
      ctx.moveTo(L, 0);
      ctx.lineTo(L * 0.2, -W * 0.45);
      ctx.lineTo(-L * 0.3, -W * 0.5);
      ctx.lineTo(-L * 0.4, -W * 0.72);
      ctx.lineTo(-L * 0.9, -W * 0.7);
      ctx.lineTo(-L * 0.9, W * 0.7);
      ctx.lineTo(-L * 0.4, W * 0.72);
      ctx.lineTo(-L * 0.3, W * 0.5);
      ctx.lineTo(L * 0.2, W * 0.45);
    } else {
      // Transport / frigate: an elongated hull with swept fins
      ctx.moveTo(L, 0);
      ctx.lineTo(L * 0.3, -W * 0.45);
      ctx.lineTo(-L * 0.6, -W * 0.5);
      ctx.lineTo(-L * 0.9, -W * (a.kind === 'frigate' ? 1 : 0.8));
      ctx.lineTo(-L * 0.8, 0);
      ctx.lineTo(-L * 0.9, W * (a.kind === 'frigate' ? 1 : 0.8));
      ctx.lineTo(-L * 0.6, W * 0.5);
      ctx.lineTo(L * 0.3, W * 0.45);
    }
    ctx.closePath();
    const hg = ctx.createLinearGradient(0, -W, 0, W);
    hg.addColorStop(0, '#56607a');
    hg.addColorStop(0.45, '#2c3346');
    hg.addColorStop(1, '#141824');
    ctx.fillStyle = flash ? '#f3f0ea' : hg;
    ctx.fill();
    ctx.strokeStyle = rgba(FRIEND, 0.8);
    ctx.lineWidth = 1.6;
    ctx.stroke();
    if (a.kind === 'cargo') {
      // Containers in mixed liveries
      const cols = ['#7a4a2e', '#46536b', '#8a6a2c'];
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = cols[(k + a.id) % 3];
        ctx.fillRect(-L * 0.85 + (L * 1.2 * k) / 3, -W * 0.42, (L * 1.2) / 3 - 3, W * 0.84);
      }
    } else {
      // Spine and a row of lit windows
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-L * 0.8, 0);
      ctx.lineTo(L * 0.6, 0);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 226, 170, 0.8)';
      const nw = a.kind === 'capital' ? 10 : 5;
      for (let k = 0; k < nw; k++) ctx.fillRect(-L * 0.6 + (k * L * 1.1) / nw, -W * 0.22, 2, 2);
    }
    // Bridge and navigation lights
    ctx.fillStyle = 'rgba(200, 225, 255, 0.9)';
    ctx.fillRect(L * 0.15, -2, 8, 4);
    if (Math.floor(t * 1.4 + a.id) % 2 === 0) {
      ctx.fillStyle = 'rgba(255, 70, 70, 0.95)';
      ctx.fillRect(-L * 0.5, -W * 0.55, 3, 3);
      ctx.fillStyle = 'rgba(90, 255, 140, 0.95)';
      ctx.fillRect(-L * 0.5, W * 0.55 - 3, 3, 3);
    }
    ctx.restore();
    // Fire and smoke when badly damaged
    if (low) {
      for (let k = 0; k < 4; k++) {
        const ph = (t * 1.5 + k / 4) % 1;
        ctx.fillStyle = k % 2 ? `rgba(90, 90, 100, ${0.4 * (1 - ph)})` : `rgba(255, ${130 + k * 30}, 60, ${0.7 * (1 - ph)})`;
        ctx.beginPath();
        ctx.arc(a.x + Math.sin(k * 2 + t) * a.r * 0.4, a.y - ph * 34, 4 + ph * 8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Callsign and hull bar
    const bw = Math.max(60, a.r * 1.6);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(a.x - bw / 2, a.y - a.r - 20, bw, 5);
    ctx.fillStyle = rgba(a.hp / a.maxHp > 0.5 ? FRIEND : a.hp / a.maxHp > 0.25 ? GOLD : RED, 0.95);
    ctx.fillRect(a.x - bw / 2, a.y - a.r - 20, (bw * a.hp) / a.maxHp, 5);
    ctx.fillStyle = rgba(FRIEND, 0.9);
    ctx.font = '600 13px "Share Tech Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(a.name.toUpperCase(), a.x, a.y - a.r - 26);
  }
}

function drawRescueZone(ctx: CanvasRenderingContext2D, m: MissionState, t: number): void {
  const z = m.rescueZone;
  if (!z) return;
  ctx.save();
  ctx.translate(z.x, z.y);
  ctx.setLineDash([12, 10]);
  ctx.lineDashOffset = -t * 30;
  ctx.strokeStyle = rgba(FRIEND, 0.75);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, z.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = rgba(FRIEND, 0.06);
  ctx.fill();
  // The rescue ship's open bay
  ctx.fillStyle = 'rgba(18, 40, 32, 0.95)';
  ctx.strokeStyle = rgba(FRIEND, 0.9);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-70, 60);
  ctx.lineTo(-40, 20);
  ctx.lineTo(40, 20);
  ctx.lineTo(70, 60);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = rgba(FRIEND, 0.9);
  ctx.font = '700 12px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('RESCUE BAY', 0, -z.r - 10);
  ctx.restore();
}

function drawPods(ctx: CanvasRenderingContext2D, m: MissionState, t: number): void {
  let leader: { x: number; y: number } = m.ship;
  for (const p of m.pods) {
    if (p.state === 'saved') continue;
    if (p.state === 'towed') {
      // Tractor tether
      ctx.strokeStyle = `rgba(150, 210, 255, ${0.5 + 0.3 * Math.sin(t * 12)})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(leader.x, leader.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.setLineDash([]);
      leader = p;
    }
    if (!p.found) {
      // Not yet located: a faint distress signal of uncertain position
      const ph = (t * 0.8 + p.id * 0.3) % 1;
      ctx.strokeStyle = rgba(GOLD, 0.45 * (1 - ph));
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 20 + ph * 70, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = rgba(GOLD, 0.7);
      ctx.font = '600 12px "Share Tech Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SIGNAL ?', p.x, p.y + 4);
      continue;
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.sin(t + p.id) * 0.4);
    ctx.fillStyle = '#d9e2f0';
    ctx.strokeStyle = rgba(CYAN, 0.9);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 11, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(20, 40, 70, 0.9)';
    ctx.beginPath();
    ctx.ellipse(0, -4, 6, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Distress beacon
    if (p.state === 'drifting' && Math.floor(t * 3 + p.id) % 2 === 0) {
      ctx.fillStyle = rgba(GOLD, 0.95);
      ctx.beginPath();
      ctx.arc(0, -19, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgba(GOLD, 0.4);
      ctx.beginPath();
      ctx.arc(0, 0, 26 + ((t * 30) % 20), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

const POWER_LOOK = {
  shield: { col: [120, 200, 255] as RGB, label: 'S' },
  overdrive: { col: ORANGE, label: '»' },
  repair: { col: FRIEND, label: '+' },
} as const;

function drawPowerPickup(ctx: CanvasRenderingContext2D, m: MissionState, t: number): void {
  const p = m.power.pickup;
  if (!p) return;
  const look = POWER_LOOK[p.kind];
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.globalAlpha = Math.min(1, p.life / 1.5) * (p.life < 2 && Math.floor(t * 8) % 2 === 0 ? 0.4 : 1);
  ctx.rotate(t * 1.2);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    if (i === 0) ctx.moveTo(Math.cos(a) * 18, Math.sin(a) * 18);
    else ctx.lineTo(Math.cos(a) * 18, Math.sin(a) * 18);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(10, 14, 24, 0.9)';
  ctx.fill();
  ctx.shadowColor = rgba(look.col, 1);
  ctx.shadowBlur = 16;
  ctx.strokeStyle = rgba(look.col, 0.95);
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.rotate(-t * 1.2);
  ctx.shadowBlur = 0;
  ctx.fillStyle = rgba(look.col, 1);
  ctx.font = '800 18px Rajdhani, Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(look.label, 0, 1);
  ctx.restore();
}

function drawGravity(ctx: CanvasRenderingContext2D, m: MissionState, t: number): void {
  const g = m.gravity;
  if (!g) return;
  ctx.save();
  ctx.translate(g.x, g.y);
  // Accretion disk: tilted rings spinning into the hole
  for (let k = 0; k < 4; k++) {
    ctx.strokeStyle = `rgba(${200 + k * 10}, ${120 - k * 20}, 255, ${0.35 - k * 0.06})`;
    ctx.lineWidth = 6 - k;
    ctx.beginPath();
    ctx.ellipse(0, 0, g.horizon * (2.4 + k * 0.9), g.horizon * (0.9 + k * 0.35), t * (0.3 + k * 0.1), 0, Math.PI * 2);
    ctx.stroke();
  }
  // Lensing glow and the event horizon
  const lens = ctx.createRadialGradient(0, 0, g.horizon, 0, 0, g.horizon * 3.2);
  lens.addColorStop(0, 'rgba(255, 180, 255, 0.35)');
  lens.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = lens;
  ctx.beginPath();
  ctx.arc(0, 0, g.horizon * 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(0, 0, g.horizon, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba(MAGENTA, m.escaping ? 0.9 : 0.55);
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
}

/** Shield bubble, overdrive glow and damage smoke on the player's ship. */
/** Shield bubble, overdrive glow and damage smoke on the player's ship. */
function drawShipStatus(ctx: CanvasRenderingContext2D, m: MissionState, t: number, reducedMotion: boolean): void {
  const s = m.ship;
  if (m.power.shield) {
    // Deflector: a soft bubble with a rotating hex shimmer
    const g = ctx.createRadialGradient(s.x, s.y, 18, s.x, s.y, 32);
    g.addColorStop(0, 'rgba(120, 190, 255, 0)');
    g.addColorStop(1, `rgba(120, 190, 255, ${0.16 + 0.06 * Math.sin(t * 5)})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(150, 205, 255, ${0.5 + 0.2 * Math.sin(t * 5)})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(150, 205, 255, 0.25)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + t * 0.8;
      ctx.beginPath();
      ctx.arc(s.x + Math.cos(a) * 32, s.y + Math.sin(a) * 32, 7, a + 2, a + 4.3);
      ctx.stroke();
    }
  }
  if (m.power.overdrive > 0) {
    ctx.strokeStyle = rgba(ORANGE, 0.6);
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 6]);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 24, t * 4, t * 4 + Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (s.hp === 1 && !reducedMotion) {
    // Critical hull: trailing smoke and sparks
    for (let k = 0; k < 4; k++) {
      const ph = (t * 2 + k / 4) % 1;
      ctx.fillStyle = `rgba(90, 90, 100, ${0.45 * (1 - ph)})`;
      ctx.beginPath();
      ctx.arc(s.x - Math.cos(s.angle) * (14 + ph * 30), s.y - Math.sin(s.angle) * (14 + ph * 30), 3 + ph * 7, 0, Math.PI * 2);
      ctx.fill();
    }
    if (Math.floor(t * 12) % 3 === 0) {
      ctx.fillStyle = rgba(GOLD, 0.9);
      ctx.fillRect(s.x + Math.sin(t * 50) * 8, s.y + Math.cos(t * 43) * 8, 3, 3);
    }
  }
}

// ---------- Ship ----------

/** Hull outlines (pointing along +x). The hit circle is the central core (radius SHIP_R). */
export const HULLS: Record<ShipId, [number, number][]> = {
  arrow: [[26, 0], [-4, 7], [-16, 18], [-12, 4], [-12, -4], [-16, -18], [-4, -7]],
  interceptor: [[28, 0], [8, 6], [-6, 22], [-14, 22], [-8, 5], [-18, 0], [-8, -5], [-14, -22], [-6, -22], [8, -6]],
  manta: [[22, 0], [6, 10], [-10, 26], [-16, 18], [-12, 0], [-16, -18], [-10, -26], [6, -10]],
  phantom: [[30, 0], [4, 5], [-2, 16], [-20, 12], [-12, 0], [-20, -12], [-2, -16], [4, -5]],
};

function drawShip(ctx: CanvasRenderingContext2D, m: MissionState, ship: ShipId, t: number, chrono: number, hurt: number): void {
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
  if (blink) ctx.globalAlpha = 0.4;
  // Twin engines: exhaust length follows thrust, with an afterburner bloom at full power
  const thrust = s.thrust;
  for (const ey of [-5, 5]) {
    const flame = 8 + thrust * 24 + Math.sin(t * 40 + ey) * 3;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const fg = ctx.createLinearGradient(-11, 0, -11 - flame, 0);
    fg.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    fg.addColorStop(0.25, rgba(CYAN, 0.9));
    fg.addColorStop(1, rgba(CYAN, 0));
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-10, ey - 3.5);
    ctx.lineTo(-11 - flame, ey);
    ctx.lineTo(-10, ey + 3.5);
    ctx.closePath();
    ctx.fill();
    if (thrust > 0.6) bloom(ctx, -12, ey, 9 + thrust * 6, CYAN, (thrust - 0.6) * 1.6);
    ctx.restore();
  }
  // Friendly under-glow: keeps the player's ship readable against every backdrop, at any size
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  bloom(ctx, 2, 0, 34, CYAN, 0.22);
  ctx.restore();
  // Hull: gunmetal with a lit upper surface
  const pts = HULLS[ship] ?? HULLS.arrow;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  const hg = ctx.createLinearGradient(0, -22, 0, 22);
  hg.addColorStop(0, '#9aa8c4');
  hg.addColorStop(0.45, '#56637f');
  hg.addColorStop(1, '#232a3c');
  ctx.fillStyle = hg;
  ctx.fill();
  ctx.strokeStyle = rgba(ship === 'phantom' ? GOLD : [170, 215, 255], 1);
  ctx.lineWidth = 2;
  ctx.stroke();
  // Panel lines and the wing accent stripes
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-16, 0);
  ctx.lineTo(22, 0);
  ctx.moveTo(-6, -14);
  ctx.lineTo(-6, 14);
  ctx.stroke();
  ctx.strokeStyle = rgba(ship === 'phantom' ? GOLD : CYAN, 0.8);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-14, -15);
  ctx.lineTo(-4, -8);
  ctx.moveTo(-14, 15);
  ctx.lineTo(-4, 8);
  ctx.stroke();
  // Hit: the hull flashes hot
  if (hurt > 0) {
    ctx.fillStyle = `rgba(255, 220, 200, ${Math.min(0.85, hurt * 3)})`;
    ctx.fillRect(-30, -30, 60, 60);
  }
  ctx.restore();
  // Cockpit canopy (the hit circle's centre)
  const cg = ctx.createLinearGradient(0, -4, 8, 4);
  cg.addColorStop(0, '#e8f3ff');
  cg.addColorStop(0.4, '#4c9dff');
  cg.addColorStop(1, '#0c1630');
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.ellipse(5, 0, 7, 3.6, 0, 0, Math.PI * 2);
  ctx.fill();
  // Navigation lights: red port, green starboard, white strobe
  const tip = pts.reduce((acc, p) => (p[1] < acc[1] ? p : acc), pts[0]);
  const on = Math.floor(t * 1.6) % 2 === 0;
  ctx.fillStyle = on ? 'rgba(255, 70, 70, 1)' : 'rgba(255, 70, 70, 0.35)';
  ctx.fillRect(tip[0] - 1.5, tip[1] - 1.5, 3, 3);
  ctx.fillStyle = on ? 'rgba(90, 255, 140, 1)' : 'rgba(90, 255, 140, 0.35)';
  ctx.fillRect(tip[0] - 1.5, -tip[1] - 1.5, 3, 3);
  if (Math.floor(t * 3) % 6 === 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    bloom(ctx, -12, 0, 8, WHITE, 0.9);
    ctx.restore();
  }
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
    ctx.font = `700 ${pop.big ? 40 : 24}px Rajdhani, Inter, sans-serif`;
    ctx.fillStyle = pop.big ? rgba(CYAN, a) : rgba(WHITE, a);
    ctx.fillText(pop.text, pop.x, pop.y);
  }
}

// ---------- Operations: aim, objective structures and targets ----------

/** The blaster's line of fire: from the muzzle along the heading, to its range. Brightens on a target. */
function drawAim(ctx: CanvasRenderingContext2D, m: MissionState, t: number): void {
  const s = m.ship;
  const ux = Math.cos(s.angle);
  const uy = Math.sin(s.angle);
  const x0 = s.x + ux * MUZZLE;
  const y0 = s.y + uy * MUZZLE;
  const locked = m.target !== null;
  ctx.save();
  ctx.setLineDash([4, 10]);
  ctx.lineDashOffset = -t * 40;
  ctx.strokeStyle = locked ? rgba(ORANGE, 0.55) : 'rgba(150, 200, 255, 0.18)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0 + ux * FIRE_RANGE, y0 + uy * FIRE_RANGE);
  ctx.stroke();
  ctx.setLineDash([]);
  // Range reticle at the end of the line
  const ex = x0 + ux * FIRE_RANGE;
  const ey = y0 + uy * FIRE_RANGE;
  ctx.strokeStyle = locked ? rgba(ORANGE, 0.7) : 'rgba(150, 200, 255, 0.3)';
  ctx.beginPath();
  ctx.arc(ex, ey, 7, 0, Math.PI * 2);
  ctx.moveTo(ex - 11, ey);
  ctx.lineTo(ex - 4, ey);
  ctx.moveTo(ex + 4, ey);
  ctx.lineTo(ex + 11, ey);
  ctx.stroke();
  ctx.restore();
}

function drawGenerator(ctx: CanvasRenderingContext2D, d: Drone, t: number, flash: boolean): void {
  // A shield pylon: an armoured base with a spinning emitter crown
  void d;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    if (i === 0) ctx.moveTo(Math.cos(a) * 22, Math.sin(a) * 22);
    else ctx.lineTo(Math.cos(a) * 22, Math.sin(a) * 22);
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(-6, -6, 2, 0, 0, 24);
  g.addColorStop(0, '#4a5468');
  g.addColorStop(1, '#151a26');
  ctx.fillStyle = flash ? '#f3f0ea' : g;
  ctx.fill();
  ctx.strokeStyle = rgba(CYAN, 0.8);
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.save();
  ctx.rotate(t * 2);
  ctx.strokeStyle = rgba([150, 210, 255], 0.9);
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(0, 0, 13, (i / 3) * Math.PI * 2, (i / 3) * Math.PI * 2 + 1.2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  bloom(ctx, 0, 0, 16, CYAN, 0.6 + 0.2 * Math.sin(t * 6));
  ctx.restore();
}

function drawHive(ctx: CanvasRenderingContext2D, d: Drone, t: number, flash: boolean): void {
  // An alien carrier: a ribbed organic shell around a glowing launch maw
  void d;
  ctx.save();
  ctx.rotate(Math.sin(t * 0.4) * 0.08);
  ctx.beginPath();
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r = 46 + Math.sin(a * 5 + t) * 4 + Math.abs(Math.sin(a * 2)) * 6;
    if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r * 0.78);
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.78);
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(-12, -14, 4, 0, 0, 52);
  g.addColorStop(0, '#4b2c63');
  g.addColorStop(1, '#170c22');
  ctx.fillStyle = flash ? '#f3f0ea' : g;
  ctx.fill();
  ctx.strokeStyle = rgba(ALIEN, 0.8);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = rgba(ALIEN, 0.3);
  ctx.lineWidth = 1.5;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.ellipse(0, 0, 40 - Math.abs(i) * 4, 30, 0, Math.PI * (0.1 + i * 0.06), Math.PI * (0.9 + i * 0.06));
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'lighter';
  bloom(ctx, 0, 14, 24, ALIEN, 0.7 + 0.3 * Math.sin(t * 4));
  bloom(ctx, 0, 14, 8, WHITE, 0.6);
  ctx.restore();
}

function drawCommander(ctx: CanvasRenderingContext2D, d: Drone, t: number, flash: boolean): void {
  // A long-hulled command raider with antenna fins and a bright sensor eye
  ctx.save();
  ctx.rotate(Math.atan2(d.vy, d.vx) || 0);
  engine(ctx, -24, -7, 8, ALIEN, t, 1.2);
  engine(ctx, -24, 7, 8, ALIEN, t + 0.4, 1.2);
  ctx.beginPath();
  ctx.moveTo(30, 0);
  ctx.lineTo(10, -8);
  ctx.lineTo(-6, -24);
  ctx.lineTo(-14, -22);
  ctx.lineTo(-10, -8);
  ctx.lineTo(-24, -6);
  ctx.lineTo(-24, 6);
  ctx.lineTo(-10, 8);
  ctx.lineTo(-14, 22);
  ctx.lineTo(-6, 24);
  ctx.lineTo(10, 8);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, -24, 0, 24);
  g.addColorStop(0, '#4d3c62');
  g.addColorStop(1, '#1a1224');
  ctx.fillStyle = flash ? '#f3f0ea' : g;
  ctx.fill();
  ctx.strokeStyle = rgba(ALIEN, 0.9);
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  bloom(ctx, 14, 0, 10, ORANGE, 0.9);
  ctx.restore();
}

/** While the Guardian is shielded, energy tethers run from each generator to the shield. */
function drawTethers(ctx: CanvasRenderingContext2D, m: MissionState, t: number): void {
  const b = m.boss;
  if (!b || !b.shielded || b.dying > 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const d of m.drones) {
    if (d.kind !== 'generator' || d.hp <= 0 || d.spawnIn > 0) continue;
    const a = Math.atan2(b.y - d.y, b.x - d.x);
    const ex = b.x - Math.cos(a) * 96;
    const ey = b.y - Math.sin(a) * 96;
    ctx.strokeStyle = rgba(CYAN, 0.25 + 0.15 * Math.sin(t * 9 + d.id));
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(220, 240, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

/** Emergency switches (Orbital Collapse): a pad that fills while the ship holds on it. */
function drawSwitches(ctx: CanvasRenderingContext2D, m: MissionState, t: number): void {
  const next = m.switches.find((w) => !w.active);
  for (const sw of m.switches) {
    const isNext = sw === next;
    const col: RGB = sw.active ? [111, 220, 156] : isNext ? ORANGE : [120, 110, 100];
    ctx.save();
    ctx.translate(sw.x, sw.y);
    ctx.setLineDash(isNext ? [8, 6] : []);
    ctx.lineDashOffset = -t * 30;
    ctx.strokeStyle = rgba(col, 0.85);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, sw.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = rgba(col, sw.active ? 0.12 : 0.06);
    ctx.fill();
    if (!sw.active && sw.charge > 0) {
      ctx.strokeStyle = rgba(GOLD, 0.95);
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, 0, sw.r - 10, -Math.PI / 2, -Math.PI / 2 + sw.charge * Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = rgba(col, 0.95);
    ctx.font = '700 13px "Share Tech Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sw.active ? `DOOR ${sw.name} OPEN` : `SWITCH ${sw.name}`, 0, 0);
    ctx.restore();
  }
}

/** A sealed blast door: heavy plates, red lock lights and chevrons. */
function drawDoor(ctx: CanvasRenderingContext2D, w: { x: number; y: number; w: number; h: number }, t: number): void {
  const g = ctx.createLinearGradient(w.x, w.y, w.x, w.y + w.h);
  g.addColorStop(0, '#3a2a26');
  g.addColorStop(1, '#1a1210');
  ctx.fillStyle = g;
  ctx.fillRect(w.x, w.y, w.w, w.h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(w.x, w.y, w.w, w.h);
  ctx.clip();
  ctx.fillStyle = 'rgba(229, 72, 77, 0.55)';
  for (let k = w.x - w.h; k < w.x + w.w; k += 22) {
    ctx.beginPath();
    ctx.moveTo(k, w.y + w.h);
    ctx.lineTo(k + 10, w.y + w.h);
    ctx.lineTo(k + 10 + w.h, w.y);
    ctx.lineTo(k + w.h, w.y);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = rgba(RED, 0.9);
  ctx.lineWidth = 2;
  ctx.strokeRect(w.x, w.y, w.w, w.h);
  const on = Math.floor(t * 2) % 2 === 0;
  ctx.fillStyle = on ? 'rgba(255, 80, 80, 1)' : 'rgba(255, 80, 80, 0.3)';
  ctx.fillRect(w.x + 6, w.y - 6, 6, 4);
  ctx.fillRect(w.x + w.w - 12, w.y - 6, 6, 4);
  ctx.fillStyle = 'rgba(255, 200, 190, 0.9)';
  ctx.font = '700 12px "Share Tech Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SEALED', w.x + w.w / 2, w.y + w.h / 2);
}
