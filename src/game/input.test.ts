import { describe, expect, it } from 'vitest';
import { Input } from './input';

describe('Input', () => {
  it('maps WASD and arrow keys to a direction', () => {
    const input = new Input();
    expect(input.handleKey('KeyD', true)).toBe(true);
    expect(input.vector()).toEqual({ x: 1, y: 0 });
    input.handleKey('KeyD', false);
    input.handleKey('ArrowUp', true);
    input.handleKey('ArrowLeft', true);
    expect(input.vector()).toEqual({ x: -1, y: -1 });
  });

  it('ignores non-movement keys', () => {
    const input = new Input();
    expect(input.handleKey('KeyP', true)).toBe(false);
    expect(input.vector()).toEqual({ x: 0, y: 0 });
  });

  it('opposite keys cancel out and holding both WASD and arrows does not double speed', () => {
    const input = new Input();
    input.handleKey('KeyA', true);
    input.handleKey('KeyD', true);
    expect(input.vector().x).toBe(0);
    input.handleKey('KeyA', false);
    input.handleKey('ArrowRight', true);
    expect(input.vector().x).toBe(1);
  });

  it('touch joystick overrides keys while active, and reset clears everything', () => {
    const input = new Input();
    input.handleKey('KeyW', true);
    input.joy = { active: true, id: 1, ox: 0, oy: 0, x: 0.5, y: 0.25 };
    expect(input.vector()).toEqual({ x: 0.5, y: 0.25 });
    input.reset();
    expect(input.vector()).toEqual({ x: 0, y: 0 });
  });
});
