import type { Vec } from './engine';

type Direction = 'up' | 'down' | 'left' | 'right';

const KEY_MAP: Record<string, Direction> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

/** Collects keyboard and touch-joystick input into a single movement vector. */
export class Input {
  private held = new Set<string>();
  /** Touch joystick: x/y are the normalised direction (-1..1). */
  joy = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };

  /** Returns true if the key is a movement key (so the caller can preventDefault). */
  handleKey(code: string, down: boolean): boolean {
    if (!(code in KEY_MAP)) return false;
    if (down) this.held.add(code);
    else this.held.delete(code);
    return true;
  }

  vector(): Vec {
    if (this.joy.active) return { x: this.joy.x, y: this.joy.y };
    const dirs = new Set<Direction>();
    for (const code of this.held) dirs.add(KEY_MAP[code]);
    return {
      x: (dirs.has('right') ? 1 : 0) - (dirs.has('left') ? 1 : 0),
      y: (dirs.has('down') ? 1 : 0) - (dirs.has('up') ? 1 : 0),
    };
  }

  reset(): void {
    this.held.clear();
    this.joy = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  }
}
