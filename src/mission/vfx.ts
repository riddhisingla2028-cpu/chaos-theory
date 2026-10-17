// Pooled combat effects for spacecraft missions: sparks, hull debris, smoke, light flashes and
// shockwaves. Purely visual and render-side (never touches the simulation), with fixed-size pools
// so a busy fight cannot allocate without bound. Reduced motion keeps the information (a flash and
// a ring where something blew up) but drops most of the flying debris.

type RGB = [number, number, number];

interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; c: RGB; len: number; w: number }
interface Shard { x: number; y: number; vx: number; vy: number; rot: number; vr: number; s: number; life: number; max: number; shape: number }
interface Smoke { x: number; y: number; vx: number; vy: number; r: number; grow: number; life: number; max: number; dark: number }
interface Flash { x: number; y: number; r: number; life: number; max: number; c: RGB }
interface Shock { x: number; y: number; r: number; speed: number; life: number; max: number; c: RGB; w: number }
interface Pending { at: number; run: () => void }

/** Fixed-capacity pool: dead items are swapped out, live ones stay packed at the front. */
class Pool<T> {
  items: T[] = [];
  n = 0;
  constructor(private cap: number, private make: () => T) {}
  get(): T | null {
    if (this.n >= this.cap) return null;
    if (this.n === this.items.length) this.items.push(this.make());
    return this.items[this.n++];
  }
  kill(i: number): void {
    this.n--;
    const t = this.items[i];
    this.items[i] = this.items[this.n];
    this.items[this.n] = t;
  }
  clear(): void {
    this.n = 0;
  }
}

/** Debris silhouettes: angular hull fragments (unit size, scaled per shard). */
const SHAPES: [number, number][][] = [
  [[1, 0], [0.2, 0.7], [-0.9, 0.4], [-0.5, -0.6]],
  [[0.9, -0.2], [0.4, 0.8], [-1, 0.2], [-0.2, -0.7]],
  [[1, 0.3], [-0.6, 0.9], [-0.8, -0.5], [0.4, -0.8]],
  [[0.7, 0], [0, 1], [-0.7, 0], [0, -0.4]],
];

const AMBER: RGB = [255, 159, 64];
const HOT: RGB = [255, 214, 160];
const BLUE: RGB = [120, 190, 255];

export class Vfx {
  private sparks = new Pool<Spark>(260, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, c: AMBER, len: 1, w: 1 }));
  private shards = new Pool<Shard>(70, () => ({ x: 0, y: 0, vx: 0, vy: 0, rot: 0, vr: 0, s: 1, life: 0, max: 1, shape: 0 }));
  private smoke = new Pool<Smoke>(60, () => ({ x: 0, y: 0, vx: 0, vy: 0, r: 1, grow: 0, life: 0, max: 1, dark: 0 }));
  private flashes = new Pool<Flash>(24, () => ({ x: 0, y: 0, r: 1, life: 0, max: 1, c: AMBER }));
  private shocks = new Pool<Shock>(16, () => ({ x: 0, y: 0, r: 0, speed: 0, life: 0, max: 1, c: AMBER, w: 1 }));
  private pending: Pending[] = [];
  private clock = 0;
  /** 0..1 scale on debris and spark counts (reduced motion, small screens). */
  density = 1;

  reset(): void {
    this.sparks.clear();
    this.shards.clear();
    this.smoke.clear();
    this.flashes.clear();
    this.shocks.clear();
    this.pending = [];
  }

  /** Number of live effects (for tests and debugging). */
  get live(): number {
    return this.sparks.n + this.shards.n + this.smoke.n + this.flashes.n + this.shocks.n;
  }

  private count(n: number): number {
    return Math.max(1, Math.round(n * this.density));
  }

  spark(x: number, y: number, ang: number, speed: number, life: number, c: RGB, len = 14, w = 2): void {
    const s = this.sparks.get();
    if (!s) return;
    s.x = x; s.y = y; s.vx = Math.cos(ang) * speed; s.vy = Math.sin(ang) * speed;
    s.life = life; s.max = life; s.c = c; s.len = len; s.w = w;
  }

  flash(x: number, y: number, r: number, life: number, c: RGB = HOT): void {
    const f = this.flashes.get();
    if (!f) return;
    f.x = x; f.y = y; f.r = r; f.life = life; f.max = life; f.c = c;
  }

  shock(x: number, y: number, speed: number, life: number, c: RGB = AMBER, w = 4): void {
    const s = this.shocks.get();
    if (!s) return;
    s.x = x; s.y = y; s.r = 6; s.speed = speed; s.life = life; s.max = life; s.c = c; s.w = w;
  }

  private shard(x: number, y: number, speed: number, size: number): void {
    const d = this.shards.get();
    if (!d) return;
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.3 + Math.random() * 0.7);
    d.x = x; d.y = y; d.vx = Math.cos(a) * v; d.vy = Math.sin(a) * v;
    d.rot = Math.random() * 6.28; d.vr = (Math.random() - 0.5) * 9;
    d.s = size * (0.5 + Math.random() * 0.8);
    d.life = d.max = 0.9 + Math.random() * 0.9;
    d.shape = Math.floor(Math.random() * SHAPES.length);
  }

  private puff(x: number, y: number, r: number, life: number, dark = 0.5): void {
    const p = this.smoke.get();
    if (!p) return;
    const a = Math.random() * Math.PI * 2;
    const v = 10 + Math.random() * 40;
    p.x = x + Math.cos(a) * r * 0.4; p.y = y + Math.sin(a) * r * 0.4;
    p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v;
    p.r = r * (0.5 + Math.random() * 0.5); p.grow = r * 1.2;
    p.life = p.max = life * (0.7 + Math.random() * 0.5); p.dark = dark;
  }

  /** A ship or rock blowing up. `size` 1 = fighter, 2 = heavy, 3 = capital-class. */
  explosion(x: number, y: number, size: 1 | 2 | 3, tint: RGB = AMBER): void {
    const k = size === 3 ? 2.6 : size === 2 ? 1.6 : 1;
    this.flash(x, y, 46 * k, 0.22 + 0.08 * k, HOT);
    this.flash(x, y, 90 * k, 0.4 + 0.1 * k, tint);
    this.shock(x, y, 260 * k, 0.45 + 0.1 * k, tint, 3 + k);
    if (size >= 2) this.shock(x, y, 160 * k, 0.6 + 0.1 * k, [255, 230, 200], 2);
    for (let i = 0, n = this.count(16 * k); i < n; i++) {
      this.spark(x, y, Math.random() * Math.PI * 2, 180 + Math.random() * 380 * k, 0.25 + Math.random() * 0.45, Math.random() < 0.3 ? HOT : tint, 10 + Math.random() * 14, 1.5 + Math.random() * 1.5);
    }
    for (let i = 0, n = this.count(5 * k); i < n; i++) this.shard(x, y, 140 + 90 * k, 4 + 2.5 * k);
    for (let i = 0, n = this.count(4 * k); i < n; i++) this.puff(x, y, 14 * k, 0.9 + 0.3 * k, 0.55);
  }

  /** A projectile striking something: a short directional spray and a pinpoint flash. */
  impact(x: number, y: number, tint: RGB = AMBER, ang = Math.random() * Math.PI * 2): void {
    this.flash(x, y, 18, 0.12, HOT);
    for (let i = 0, n = this.count(6); i < n; i++) this.spark(x, y, ang + Math.PI + (Math.random() - 0.5) * 1.6, 120 + Math.random() * 220, 0.15 + Math.random() * 0.2, tint, 8, 1.5);
  }

  /** The player's hull taking a hit: a hard white-amber burst. */
  hullHit(x: number, y: number): void {
    this.flash(x, y, 60, 0.25, HOT);
    this.shock(x, y, 220, 0.35, [255, 120, 80], 3);
    for (let i = 0, n = this.count(14); i < n; i++) this.spark(x, y, Math.random() * Math.PI * 2, 160 + Math.random() * 260, 0.3 + Math.random() * 0.3, Math.random() < 0.5 ? HOT : AMBER, 12, 2);
    for (let i = 0, n = this.count(3); i < n; i++) this.shard(x, y, 160, 4);
  }

  /** A shield soaking a hit: a blue ripple instead of sparks. */
  shieldHit(x: number, y: number): void {
    this.shock(x, y, 180, 0.4, BLUE, 3);
    this.flash(x, y, 50, 0.2, BLUE);
    for (let i = 0, n = this.count(8); i < n; i++) this.spark(x, y, Math.random() * Math.PI * 2, 140 + Math.random() * 120, 0.25, BLUE, 8, 1.5);
  }

  /** Muzzle flash at a gun barrel. */
  muzzle(x: number, y: number, ang: number, tint: RGB = BLUE): void {
    this.flash(x, y, 16, 0.07, tint);
    if (this.density > 0.6) this.spark(x, y, ang + (Math.random() - 0.5) * 0.5, 260, 0.08, [220, 240, 255], 10, 1.5);
  }

  /** A shower of sparks from an object (pickups, gates, pods). */
  burst(x: number, y: number, n: number, tint: RGB, speed = 220): void {
    for (let i = 0, c = this.count(n); i < c; i++) this.spark(x, y, Math.random() * Math.PI * 2, speed * (0.4 + Math.random() * 0.6), 0.3 + Math.random() * 0.3, tint, 9, 1.5);
  }

  /** A chain of explosions across a large hull, then the final blast (boss / capital ship). */
  chain(x: number, y: number, radius: number, count: number, span: number, tint: RGB = AMBER): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = radius * Math.random();
      const at = this.clock + (span * i) / count;
      this.pending.push({ at, run: () => this.explosion(x + Math.cos(a) * r, y + Math.sin(a) * r, 1, tint) });
    }
    this.pending.push({ at: this.clock + span, run: () => this.explosion(x, y, 3, tint) });
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.pending.length) {
      const due = this.pending.filter((p) => p.at <= this.clock);
      if (due.length) {
        this.pending = this.pending.filter((p) => p.at > this.clock);
        for (const p of due) p.run();
      }
    }
    const drag = Math.pow(0.08, dt); // strong drag: bursts read as bursts, not a slow drift
    for (let i = this.sparks.n - 1; i >= 0; i--) {
      const s = this.sparks.items[i];
      s.life -= dt;
      if (s.life <= 0) { this.sparks.kill(i); continue; }
      s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= drag; s.vy *= drag;
    }
    const sdrag = Math.pow(0.35, dt);
    for (let i = this.shards.n - 1; i >= 0; i--) {
      const d = this.shards.items[i];
      d.life -= dt;
      if (d.life <= 0) { this.shards.kill(i); continue; }
      d.x += d.vx * dt; d.y += d.vy * dt; d.vx *= sdrag; d.vy *= sdrag; d.rot += d.vr * dt;
    }
    for (let i = this.smoke.n - 1; i >= 0; i--) {
      const p = this.smoke.items[i];
      p.life -= dt;
      if (p.life <= 0) { this.smoke.kill(i); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.grow * dt * (p.life / p.max);
    }
    for (let i = this.flashes.n - 1; i >= 0; i--) {
      const f = this.flashes.items[i];
      f.life -= dt;
      if (f.life <= 0) this.flashes.kill(i);
    }
    for (let i = this.shocks.n - 1; i >= 0; i--) {
      const s = this.shocks.items[i];
      s.life -= dt;
      if (s.life <= 0) { this.shocks.kill(i); continue; }
      s.r += s.speed * dt * (0.4 + 0.6 * (s.life / s.max)); // decelerates as it spreads
    }
  }

  /** Smoke and tumbling hull fragments: drawn beneath ships. */
  drawUnder(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < this.smoke.n; i++) {
      const p = this.smoke.items[i];
      const a = p.life / p.max;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      g.addColorStop(0, `rgba(${60 + 40 * a}, ${58 + 30 * a}, ${66}, ${0.32 * a * p.dark * 2})`);
      g.addColorStop(1, 'rgba(30, 32, 40, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < this.shards.n; i++) {
      const d = this.shards.items[i];
      const a = Math.min(1, d.life / d.max * 1.5);
      const heat = Math.max(0, d.life / d.max - 0.45) / 0.55; // glowing hot at first, then cools to metal
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rot);
      ctx.scale(d.s, d.s);
      ctx.beginPath();
      const pts = SHAPES[d.shape];
      pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.globalAlpha = a;
      ctx.fillStyle = `rgb(${58 + heat * 150}, ${64 + heat * 70}, ${78 - heat * 30})`;
      ctx.fill();
      ctx.lineWidth = 0.35;
      ctx.strokeStyle = `rgba(255, ${170 + heat * 60}, 110, ${0.3 + 0.7 * heat})`;
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /** Sparks, flashes and shockwaves: additive light drawn over everything in the world. */
  drawOver(ctx: CanvasRenderingContext2D): void {
    const prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.flashes.n; i++) {
      const f = this.flashes.items[i];
      const a = f.life / f.max;
      const r = f.r * (1.15 - 0.15 * a);
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      g.addColorStop(0, `rgba(${f.c[0]}, ${f.c[1]}, ${f.c[2]}, ${0.75 * a})`);
      g.addColorStop(0.35, `rgba(${f.c[0]}, ${f.c[1]}, ${f.c[2]}, ${0.3 * a})`);
      g.addColorStop(1, `rgba(${f.c[0]}, ${f.c[1]}, ${f.c[2]}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < this.shocks.n; i++) {
      const s = this.shocks.items[i];
      const a = s.life / s.max;
      ctx.strokeStyle = `rgba(${s.c[0]}, ${s.c[1]}, ${s.c[2]}, ${0.7 * a})`;
      ctx.lineWidth = s.w * (0.4 + a);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineCap = 'round';
    for (let i = 0; i < this.sparks.n; i++) {
      const s = this.sparks.items[i];
      const a = s.life / s.max;
      const sp = Math.hypot(s.vx, s.vy) || 1;
      const L = Math.min(s.len, sp * 0.06) + 2;
      ctx.strokeStyle = `rgba(${s.c[0]}, ${s.c[1]}, ${s.c[2]}, ${a})`;
      ctx.lineWidth = s.w;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - (s.vx / sp) * L, s.y - (s.vy / sp) * L);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = prev;
  }
}
