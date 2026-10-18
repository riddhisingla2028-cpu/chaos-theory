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

describe('mission fire input', () => {
  it('Space held fires every step; release stops', () => {
    const i = new Input();
    expect(i.handleFireKey('Space', true)).toBe(true);
    expect(i.consumeFire()).toBe(true);
    expect(i.consumeFire()).toBe(true);
    i.handleFireKey('Space', false);
    expect(i.consumeFire()).toBe(false);
  });

  it('a tap shorter than a frame still fires exactly once', () => {
    const i = new Input();
    i.handleFireKey('Space', true);
    i.handleFireKey('Space', false);
    expect(i.consumeFire()).toBe(true);
    expect(i.consumeFire()).toBe(false);
  });

  it('touch FIRE: several fingers, each release counted; cancel releases', () => {
    const i = new Input();
    i.setTouchFire(1, true);
    i.setTouchFire(2, true);
    i.setTouchFire(1, false);
    expect(i.fireHeld).toBe(true);
    i.setTouchFire(2, false); // pointercancel goes through the same release
    expect(i.fireHeld).toBe(false);
  });

  it('reset (blur, pause, mission end) releases every fire source', () => {
    const i = new Input();
    i.handleFireKey('Space', true);
    i.setMouseFire(true);
    i.setTouchFire(3, true);
    i.reset();
    expect(i.fireHeld).toBe(false);
    expect(i.consumeFire()).toBe(false);
  });

  it('other keys are not fire keys, and movement keys are unaffected', () => {
    const i = new Input();
    expect(i.handleFireKey('KeyW', true)).toBe(false);
    i.handleKey('KeyW', true);
    i.handleFireKey('Space', true);
    expect(i.vector()).toEqual({ x: 0, y: -1 });
  });
});

describe('touch FIRE released by cancel, frame by frame (regression for the browser fire test)', () => {
  // The browser test once read the shot counter, then sent the cancel: a shot fired in between was
  // counted as "after the cancel". This replays the same sequence deterministically through the real
  // Input class and mission simulation, one 60 Hz frame at a time.
  it('two fingers (stick + FIRE), then a cancel: not a single shot is fired after the frame that sees the cancel', async () => {
    const { createMission, missionById, stepMission } = await import('../mission/sim');
    for (let cancelFrame = 20; cancelFrame < 40; cancelFrame++) {
      const m = createMission(missionById('breach-protocol'), 3);
      m.encounters = [];
      m.drones = [];
      m.ship.invuln = 999;
      const input = new Input();
      input.joy = { active: true, id: 2, ox: 0, oy: 0, x: 0.5, y: 0 }; // flying with one finger
      input.setTouchFire(1, true); // holding FIRE with the other
      let shotsAfter = 0;
      for (let f = 0; f < 120; f++) {
        if (f === cancelFrame) {
          // touchcancel: the browser sends pointercancel for both fingers
          input.setTouchFire(1, false);
          input.joy = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };
        }
        stepMission(m, { ...input.vector(), fire: input.consumeFire() }, 1 / 60);
        if (f >= cancelFrame) shotsAfter += m.events.filter((e) => e.type === 'shoot').length;
      }
      expect(shotsAfter, `cancel at frame ${cancelFrame}`).toBe(0);
      expect(input.fireHeld).toBe(false);
      expect(m.flags.shots).toBeGreaterThan(0); // it was firing before the cancel
    }
  });

  it('a press and cancel inside one frame still counts as a single tap (never more)', () => {
    const input = new Input();
    input.setTouchFire(1, true);
    input.setTouchFire(1, false);
    expect(input.consumeFire()).toBe(true);
    for (let i = 0; i < 10; i++) expect(input.consumeFire()).toBe(false);
  });
});
