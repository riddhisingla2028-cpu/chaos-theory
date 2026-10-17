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

  /** Primary fire sources (missions): held keys, the mouse button, and touch FIRE buttons by pointer id. */
  private fireKeys = new Set<string>();
  private fireMouse = false;
  private fireTouches = new Set<number>();
  /** A press that has not been seen by a game step yet, so a tap shorter than a frame still fires once. */
  private fireLatched = false;

  /** Space is primary fire. Returns true if the key is a fire key (so the caller can preventDefault). */
  handleFireKey(code: string, down: boolean): boolean {
    if (code !== 'Space') return false;
    if (down) {
      if (!this.fireKeys.has(code)) this.fireLatched = true;
      this.fireKeys.add(code);
    } else this.fireKeys.delete(code);
    return true;
  }

  setMouseFire(down: boolean): void {
    if (down && !this.fireMouse) this.fireLatched = true;
    this.fireMouse = down;
  }

  setTouchFire(pointerId: number, down: boolean): void {
    if (down) {
      if (!this.fireTouches.size) this.fireLatched = true;
      this.fireTouches.add(pointerId);
    } else this.fireTouches.delete(pointerId);
  }

  /** Is fire held right now (or was it tapped since the last step)? Clears the tap latch. */
  consumeFire(): boolean {
    const f = this.fireLatched || this.fireKeys.size > 0 || this.fireMouse || this.fireTouches.size > 0;
    this.fireLatched = false;
    return f;
  }

  get fireHeld(): boolean {
    return this.fireKeys.size > 0 || this.fireMouse || this.fireTouches.size > 0;
  }

  /** Release every fire source (pause, blur, mission end): nothing can stay stuck firing. */
  releaseFire(): void {
    this.fireKeys.clear();
    this.fireMouse = false;
    this.fireTouches.clear();
    this.fireLatched = false;
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
    this.releaseFire();
    this.held.clear();
    this.joy = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  }
}
