import {
  AFTERIMAGE_ARM,
  AFTERIMAGE_LIFE,
  ARENA,
  COLLAPSE_INSET,
  PLAYER_HALF,
  TRAIL_HIT_RADIUS,
  isActive,
  type GameState,
} from './engine';

const ARENA_BG = '#151519';
const TEXT = '#F3F0EA';
const DANGER = '#C84B4B';
const text = (a: number) => `rgba(243, 240, 234, ${a})`;
const danger = (a: number) => `rgba(200, 75, 75, ${a})`;

/** Draws one frame. `sizePx` is the CSS size of the square canvas, `t` is wall-clock seconds for ambient animation. */
export function drawGame(ctx: CanvasRenderingContext2D, s: GameState, sizePx: number, dpr: number, t: number): void {
  const scale = sizePx / ARENA;
  const px = 1 / scale; // one CSS pixel in arena units

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);

  ctx.fillStyle = ARENA_BG;
  ctx.fillRect(0, 0, ARENA, ARENA);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, ARENA, ARENA);
  ctx.clip();
  drawGrid(ctx, px);
  drawGravity(ctx, s, t);
  drawCollapse(ctx, s, t, px);
  drawTrail(ctx, s);
  drawHazards(ctx, s);
  drawPlayer(ctx, s);
  ctx.restore();

  ctx.lineWidth = px;
  ctx.strokeStyle = s.chaos?.phase === 'active' ? danger(0.55) : text(0.1);
  ctx.strokeRect(px / 2, px / 2, ARENA - px, ARENA - px);
}

function drawGrid(ctx: CanvasRenderingContext2D, px: number): void {
  ctx.strokeStyle = text(0.035);
  ctx.lineWidth = px;
  ctx.beginPath();
  for (let i = 100; i < ARENA; i += 100) {
    ctx.moveTo(i, 0);
    ctx.lineTo(i, ARENA);
    ctx.moveTo(0, i);
    ctx.lineTo(ARENA, i);
  }
  ctx.stroke();
}

function drawGravity(ctx: CanvasRenderingContext2D, s: GameState, t: number): void {
  const c = s.chaos;
  if (!c || c.kind !== 'GRAVITY') return;
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
    ctx.fillStyle = danger(0.16);
    ctx.fillRect(0, 0, ARENA, i);
    ctx.fillRect(0, ARENA - i, ARENA, i);
    ctx.fillRect(0, i, i, ARENA - 2 * i);
    ctx.fillRect(ARENA - i, i, i, ARENA - 2 * i);
    ctx.strokeStyle = danger(0.9);
    ctx.lineWidth = 2 * px;
    ctx.strokeRect(i, i, ARENA - 2 * i, ARENA - 2 * i);
  }
  const c = s.chaos;
  if (c?.kind === 'COLLAPSE' && c.phase === 'warning') {
    ctx.setLineDash([14, 10]);
    ctx.strokeStyle = danger(0.4 + 0.35 * Math.sin(t * 10));
    ctx.lineWidth = 2 * px;
    ctx.strokeRect(COLLAPSE_INSET, COLLAPSE_INSET, ARENA - 2 * COLLAPSE_INSET, ARENA - 2 * COLLAPSE_INSET);
    ctx.setLineDash([]);
  }
}

function drawTrail(ctx: CanvasRenderingContext2D, s: GameState): void {
  const trail = s.trail;
  if (trail.length < 2) return;
  const c = s.chaos;
  const warning = c?.kind === 'AFTERIMAGE' && c.phase === 'warning';

  // Faint ribbon showing recent movement.
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
  ctx.strokeStyle = warning ? danger(0.3) : text(0.07);
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
      ctx.fillStyle = danger(0.12 + 0.8 * fade);
      ctx.arc(p.x, p.y, TRAIL_HIT_RADIUS, 0, Math.PI * 2);
    } else if (age < AFTERIMAGE_ARM) {
      ctx.fillStyle = text(0.3);
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    } else continue;
    ctx.fill();
  }
}

function drawHazards(ctx: CanvasRenderingContext2D, s: GameState): void {
  for (const h of s.hazards) {
    if (h.kind === 'drifter') {
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
      ctx.fillStyle = danger(0.92);
      ctx.fill();
    } else {
      const alpha = Math.min(1, h.life - h.age, h.age * 3);
      const size = h.r * 1.35;
      ctx.save();
      ctx.translate(h.x, h.y);
      ctx.rotate(Math.atan2(h.vy, h.vx));
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.8, size * 0.8);
      ctx.lineTo(-size * 0.8, -size * 0.8);
      ctx.closePath();
      ctx.fillStyle = danger(0.25 * alpha);
      ctx.fill();
      ctx.strokeStyle = danger(alpha);
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawPlayer(ctx: CanvasRenderingContext2D, s: GameState): void {
  const p = s.player;
  const h = PLAYER_HALF;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(Math.max(-0.35, Math.min(0.35, p.vx * 0.0009)));
  if (s.status === 'over') {
    ctx.strokeStyle = DANGER;
    ctx.lineWidth = 3;
    ctx.strokeRect(-h, -h, h * 2, h * 2);
  } else {
    ctx.shadowColor = text(0.5);
    ctx.shadowBlur = 16;
    if (isActive(s, 'INVERSION')) {
      // Hollow square signals that controls are inverted.
      ctx.strokeStyle = TEXT;
      ctx.lineWidth = 4;
      ctx.strokeRect(-h + 2, -h + 2, h * 2 - 4, h * 2 - 4);
    } else {
      ctx.fillStyle = TEXT;
      ctx.fillRect(-h, -h, h * 2, h * 2);
    }
  }
  ctx.restore();
}
