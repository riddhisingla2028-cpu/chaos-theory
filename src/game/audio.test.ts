import { describe, expect, it, vi } from 'vitest';
import { Sfx } from './audio';

/** A minimal stand-in for the browser's AudioContext, enough to observe what the engine does. */
class FakeContext {
  state: string;
  onstatechange: (() => void) | null = null;
  currentTime = 0;
  destination = {};
  oscillators = 0;
  resumeCalls = 0;
  constructor(
    initial = 'suspended',
    private resumeBehaviour: 'ok' | 'reject' | 'stay' = 'ok',
  ) {
    this.state = initial;
  }
  private node() {
    const param = () => ({
      value: 0,
      setValueAtTime() {},
      exponentialRampToValueAtTime() {},
      cancelScheduledValues() {},
      setTargetAtTime(this: { value: number }, v: number) {
        this.value = v;
      },
    });
    const n: Record<string, unknown> = {
      gain: param(),
      frequency: param(),
      detune: param(),
      threshold: param(),
      ratio: param(),
      type: '',
      buffer: null,
      connect: (t: unknown) => t,
      start() {},
      stop() {},
    };
    return n;
  }
  createGain = () => this.node();
  createDynamicsCompressor = () => this.node();
  createBiquadFilter = () => this.node();
  createBufferSource = () => this.node();
  createBuffer = () => ({ getChannelData: () => new Float32Array(4) });
  createOscillator = () => {
    this.oscillators++;
    return this.node();
  };
  resume() {
    this.resumeCalls++;
    if (this.resumeBehaviour === 'reject') return Promise.reject(new Error('NotAllowedError'));
    if (this.resumeBehaviour === 'ok') {
      this.state = 'running';
      this.onstatechange?.();
    }
    return Promise.resolve();
  }
  setState(st: string) {
    this.state = st;
    this.onstatechange?.();
  }
}

const make = (ctx: FakeContext) => {
  const factory = vi.fn(() => ctx as unknown as AudioContext);
  return { sfx: new Sfx(factory), factory };
};

describe('audio unlocking', () => {
  it('creates no AudioContext until unlock() is called from a gesture', () => {
    const { sfx, factory } = make(new FakeContext());
    sfx.play('click');
    sfx.setAmbient(true);
    expect(factory).not.toHaveBeenCalled();
    expect(sfx.audioState).toBe('locked');
  });

  it('resumes a suspended context and reports running only once the browser confirms', async () => {
    const ctx = new FakeContext('suspended', 'ok');
    const { sfx } = make(ctx);
    const states: string[] = [];
    sfx.subscribe((st) => states.push(st));
    const result = await sfx.unlock();
    expect(ctx.resumeCalls).toBe(1);
    expect(result).toBe('running');
    expect(states).toContain('running');
    sfx.play('click');
    expect(ctx.oscillators).toBeGreaterThan(0);
  });

  it('reuses one AudioContext however often it is unlocked', async () => {
    const { sfx, factory } = make(new FakeContext());
    await sfx.unlock();
    await sfx.unlock();
    await sfx.unlock();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('handles a rejected resume() without throwing and stays quiet until the next gesture', async () => {
    const ctx = new FakeContext('suspended', 'reject');
    const { sfx } = make(ctx);
    await expect(sfx.unlock()).resolves.toBe('suspended');
    sfx.play('death');
    expect(ctx.oscillators).toBe(0);
  });

  it('reports unavailable (and never throws) when the device has no Web Audio', async () => {
    const sfx = new Sfx(() => {
      throw new Error('no audio');
    });
    await expect(sfx.unlock()).resolves.toBe('unavailable');
    expect(() => sfx.play('click')).not.toThrow();
    const none = new Sfx(() => null);
    await expect(none.unlock()).resolves.toBe('unavailable');
  });

  it('recovers after the browser suspends audio (backgrounding, iOS interruptions)', async () => {
    const ctx = new FakeContext('suspended', 'ok');
    const { sfx } = make(ctx);
    await sfx.unlock();
    ctx.setState('interrupted');
    expect(sfx.audioState).toBe('suspended');
    sfx.resumeIfPossible();
    await Promise.resolve();
    expect(sfx.audioState).toBe('running');
  });
});

describe('mute and music', () => {
  it('muted: no sounds and no music, and unmuting starts the music once', async () => {
    const ctx = new FakeContext('suspended', 'ok');
    const { sfx } = make(ctx);
    sfx.setMuted(true);
    await sfx.unlock();
    sfx.setAmbient(true);
    sfx.play('orb');
    expect(ctx.oscillators).toBe(0);
    expect(sfx.ambientLoops).toBe(0);
    sfx.setMuted(false);
    expect(sfx.ambientLoops).toBe(1);
  });

  it('never runs two music loops, however often screens switch', async () => {
    const { sfx } = make(new FakeContext('running'));
    await sfx.unlock();
    for (let i = 0; i < 10; i++) sfx.setAmbient(true);
    expect(sfx.ambientLoops).toBe(1);
    sfx.setAmbient(false);
    expect(sfx.ambientLoops).toBe(0);
    sfx.setAmbient(true);
    expect(sfx.ambientLoops).toBe(1);
  });

  it('music requested before audio is unlocked starts as soon as it is', async () => {
    const { sfx } = make(new FakeContext('suspended', 'ok'));
    sfx.setAmbient(true);
    expect(sfx.ambientLoops).toBe(0);
    await sfx.unlock();
    expect(sfx.ambientLoops).toBe(1);
  });
});

describe('separate sound and music volume', () => {
  it('music volume 0 stops the music but sound effects still play', async () => {
    const ctx = new FakeContext();
    const { sfx } = make(ctx);
    await sfx.unlock();
    sfx.setAmbient(true);
    expect(sfx.ambientLoops).toBe(1);
    sfx.setVolumes(1, 0);
    expect(sfx.ambientLoops).toBe(0);
    const before = ctx.oscillators;
    sfx.play('orb');
    expect(ctx.oscillators).toBeGreaterThan(before);
  });

  it('sound volume 0 silences effects without touching the music', async () => {
    const ctx = new FakeContext();
    const { sfx } = make(ctx);
    await sfx.unlock();
    sfx.setVolumes(0, 1);
    sfx.setAmbient(true);
    expect(sfx.ambientLoops).toBe(1);
    const before = ctx.oscillators;
    sfx.play('orb');
    expect(ctx.oscillators).toBe(before);
  });

  it('never goes above full volume, whatever it is given', () => {
    const { sfx } = make(new FakeContext());
    sfx.setVolumes(5, Number.NaN);
    expect(sfx.volumes).toEqual({ sfx: 1, music: 1 });
    sfx.setVolumes(-1, 0.5);
    expect(sfx.volumes).toEqual({ sfx: 0, music: 0.25 });
  });
});

describe('engine sound', () => {
  const running = async () => {
    const ctx = new FakeContext();
    const { sfx } = make(ctx);
    await sfx.unlock();
    return { sfx, ctx };
  };

  it('runs one engine loop that follows thrust, never two', async () => {
    const { sfx } = await running();
    sfx.setEngine(0.2);
    sfx.setEngine(0.9);
    sfx.setEngine(0.5);
    expect(sfx.engineLoops).toBe(1);
    sfx.setEngine(null);
    expect(sfx.engineLoops).toBe(0);
  });

  it('mute and sound volume 0 silence the engine; unmuting brings it back while still flying', async () => {
    const { sfx } = await running();
    sfx.setEngine(0.5);
    sfx.setMuted(true);
    expect(sfx.engineLoops).toBe(0);
    sfx.setMuted(false);
    expect(sfx.engineLoops).toBe(1);
    sfx.setVolumes(0, 1);
    expect(sfx.engineLoops).toBe(0);
  });

  it('does nothing before audio is unlocked, and stops when the browser suspends audio', async () => {
    const ctx = new FakeContext();
    const { sfx } = make(ctx);
    sfx.setEngine(0.5);
    expect(sfx.engineLoops).toBe(0);
    await sfx.unlock();
    expect(sfx.engineLoops).toBe(1);
    ctx.setState('suspended');
    expect(sfx.engineLoops).toBe(0);
  });
});
