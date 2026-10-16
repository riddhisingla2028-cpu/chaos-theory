// Render-side visual effects (particles, popups, screen shake, flashes).
// Kept separate from the engine so the simulation stays deterministic and testable.

import type { GameState } from './engine';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  accent: boolean;
  color?: string; // explicit colour (celebration confetti)
}

export interface Popup {
  x: number;
  y: number;
  text: string;
  life: number;
  max: number;
  big: boolean;
}

const MAX_PARTICLES = 240;

export class Fx {
  particles: Particle[] = [];
  popups: Popup[] = [];
  shake = 0;
  flash = 0;
  private thrustClock = 0;

  reset(): void {
    this.particles = [];
    this.popups = [];
    this.shake = 0;
    this.flash = 0;
  }

  burst(x: number, y: number, count: number, speed: number, accent: boolean, size = 5, life = 0.7): void {
    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.35 + Math.random() * 0.65);
      const l = life * (0.6 + Math.random() * 0.4);
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: l, max: l, size: size * (0.5 + Math.random() * 0.7), accent });
    }
  }

  popup(x: number, y: number, text: string, big = false): void {
    if (this.popups.length > 6) this.popups.shift();
    this.popups.push({ x, y, text, life: big ? 1.1 : 0.8, max: big ? 1.1 : 0.8, big });
  }

  addShake(amount: number): void {
    this.shake = Math.min(28, this.shake + amount);
  }

  /** Small sparks behind a fast-moving player. */
  thrust(g: GameState, dt: number): void {
    const p = g.player;
    const speed = Math.hypot(p.vx, p.vy);
    this.thrustClock -= dt;
    if (speed < 220 || this.thrustClock > 0) return;
    this.thrustClock = 0.045;
    if (this.particles.length >= MAX_PARTICLES) return;
    const back = { x: -p.vx / speed, y: -p.vy / speed };
    this.particles.push({
      x: p.x + back.x * 12 + (Math.random() - 0.5) * 8,
      y: p.y + back.y * 12 + (Math.random() - 0.5) * 8,
      vx: back.x * 60 + (Math.random() - 0.5) * 40,
      vy: back.y * 60 + (Math.random() - 0.5) * 40,
      life: 0.35,
      max: 0.35,
      size: 3,
      accent: false,
    });
  }

  /** Multi-colour confetti for victories. */
  confetti(x: number, y: number, count: number, colors: string[]): void {
    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES + 120; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 200 + Math.random() * 520;
      const l = 0.9 + Math.random() * 0.9;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, life: l, max: l, size: 6 + Math.random() * 8, accent: false, color: colors[i % colors.length] });
    }
  }

  update(dt: number): void {
    for (const pt of this.particles) {
      pt.life -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 1 - Math.min(1, dt * 3);
      pt.vy *= 1 - Math.min(1, dt * 3);
    }
    this.particles = this.particles.filter((pt) => pt.life > 0);
    for (const pop of this.popups) {
      pop.life -= dt;
      pop.y -= 40 * dt;
    }
    this.popups = this.popups.filter((pop) => pop.life > 0);
    this.shake = Math.max(0, this.shake - dt * 60);
    this.flash = Math.max(0, this.flash - dt * 2.5);
  }
}
