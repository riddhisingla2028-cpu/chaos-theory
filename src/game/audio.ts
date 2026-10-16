// Tiny synthesized sound effects via the Web Audio API. No audio files, no dependencies.
// The context is created and resumed only inside genuine user gestures, as mobile browsers require.

export type SoundName =
  | 'click'
  | 'start'
  | 'warning'
  | 'chaos'
  | 'near'
  | 'pass'
  | 'combo'
  | 'glitch'
  | 'death'
  | 'win'
  | 'unlock'
  | 'hover'
  | 'whoosh'
  | 'boot'
  | 'orb'
  | 'bossHit'
  | 'beam'
  | 'levelup';

type Wave = OscillatorType;

/**
 * What the player can expect to hear:
 * - locked: no gesture yet, so the browser has not allowed audio
 * - running: sound works
 * - suspended: the browser paused audio (blocked, backgrounded or interrupted); a tap resumes it
 * - unavailable: this device or browser has no usable Web Audio
 */
export type AudioState = 'locked' | 'running' | 'suspended' | 'unavailable';

export type ContextFactory = () => AudioContext | null;

const defaultFactory: ContextFactory = () => {
  const Ctor =
    typeof window === 'undefined'
      ? undefined
      : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctor ? new Ctor() : null;
};

/** iOS: ask for "playback" so the hardware silent switch does not mute the game (Safari 17+). */
function preferPlaybackSession(): void {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession && nav.audioSession.type !== 'playback') nav.audioSession.type = 'playback';
  } catch {
    // not supported: harmless
  }
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxVolume = 1;
  private musicVolume = 1;
  private lastNear = 0;
  private lastHover = 0;
  private ambient: { gain: GainNode; nodes: AudioScheduledSourceNode[] } | null = null;
  private wantAmbient = false;
  private state: AudioState = 'locked';
  private listeners = new Set<(s: AudioState) => void>();
  muted = false;

  constructor(private readonly factory: ContextFactory = defaultFactory) {}

  get audioState(): AudioState {
    return this.state;
  }

  /** Subscribe to audio state changes (for the sound button). Returns an unsubscribe function. */
  subscribe(fn: (s: AudioState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setState(next: AudioState): void {
    if (next === this.state) return;
    this.state = next;
    if (next === 'running') this.syncAmbient();
    else this.stopAmbient();
    this.listeners.forEach((fn) => fn(next));
  }

  private syncState(): void {
    const st = this.ctx?.state as string | undefined;
    if (!this.ctx) return;
    // 'interrupted' (iOS) and 'closed' are treated as suspended: a later tap can recover.
    this.setState(st === 'running' ? 'running' : 'suspended');
  }

  /**
   * Start or resume audio. Call it from inside a genuine user gesture (click, touchend, keydown).
   * Safe to call repeatedly: it creates at most one AudioContext and resolves once the browser
   * has confirmed the result.
   */
  unlock(): Promise<AudioState> {
    if (this.state === 'unavailable') return Promise.resolve(this.state);
    try {
      if (!this.ctx) {
        const ctx = this.factory();
        if (!ctx) {
          this.setState('unavailable');
          return Promise.resolve(this.state);
        }
        this.ctx = ctx;
        // Master volume through a compressor so stacked sounds never clip.
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 6;
        this.master = ctx.createGain();
        this.master.gain.value = 0.16;
        this.master.connect(comp).connect(ctx.destination);
        // Separate buses so sound effects and music have their own volume.
        this.sfxBus = ctx.createGain();
        this.sfxBus.gain.value = this.sfxVolume;
        this.sfxBus.connect(this.master);
        this.musicBus = ctx.createGain();
        this.musicBus.gain.value = this.musicVolume;
        this.musicBus.connect(this.master);
        ctx.onstatechange = () => this.syncState();
        preferPlaybackSession();
      }
      const ctx = this.ctx;
      if (ctx.state === 'running') {
        this.setState('running');
        return Promise.resolve(this.state);
      }
      this.primeSilently();
      return Promise.resolve(ctx.resume()).then(
        () => {
          this.syncState();
          return this.state;
        },
        () => {
          // The browser refused (no valid gesture). Stay quiet; the next tap will try again.
          this.syncState();
          return this.state;
        },
      );
    } catch {
      this.setState('unavailable');
      return Promise.resolve(this.state);
    }
  }

  /** Try to resume after returning to the tab; works only where the browser allows it without a tap. */
  resumeIfPossible(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running' || (ctx.state as string) === 'closed') return;
    try {
      Promise.resolve(ctx.resume()).then(
        () => this.syncState(),
        () => this.syncState(),
      );
    } catch {
      this.syncState();
    }
  }

  /** A one-sample silent buffer played inside the gesture: the classic iOS audio unlock. */
  private primeSilently(): void {
    try {
      const ctx = this.ctx!;
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      // ignore: priming is best-effort
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.syncAmbient();
  }

  /**
   * Volumes from 0 to 1 for sound effects and music. Values are clamped and squared so the
   * slider feels even to the ear and can never exceed the original level (no sudden loud audio).
   */
  setVolumes(sfx: number, music: number): void {
    const clamp = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1);
    this.sfxVolume = clamp(sfx) ** 2;
    this.musicVolume = clamp(music) ** 2;
    try {
      const now = this.ctx?.currentTime ?? 0;
      this.sfxBus?.gain.setTargetAtTime(this.sfxVolume, now, 0.05);
      this.musicBus?.gain.setTargetAtTime(this.musicVolume, now, 0.05);
    } catch {
      // Audio must never break the game.
    }
    this.syncAmbient();
  }

  get volumes(): { sfx: number; music: number } {
    return { sfx: this.sfxVolume, music: this.musicVolume };
  }

  /** Menu music on or off. Starts only once audio is running and unmuted; never duplicates. */
  setAmbient(on: boolean): void {
    this.wantAmbient = on;
    this.syncAmbient();
  }

  private syncAmbient(): void {
    if (this.wantAmbient && !this.muted && this.musicVolume > 0 && this.state === 'running') this.startAmbient();
    else this.stopAmbient();
  }

  play(name: SoundName): void {
    if (this.muted || this.sfxVolume <= 0 || !this.ctx || !this.master || this.state !== 'running') return;
    try {
      this.playUnsafe(name);
    } catch {
      // Audio must never break the game.
    }
  }

  private playUnsafe(name: SoundName): void {
    switch (name) {
      case 'click':
        this.tone(660, 0.05, 'triangle', 0.25);
        break;
      case 'start':
        this.tone(392, 0.12, 'triangle', 0.5);
        this.tone(587, 0.2, 'triangle', 0.5, 0.1);
        break;
      case 'warning':
        this.tone(880, 0.07, 'square', 0.18);
        this.tone(880, 0.07, 'square', 0.18, 0.14);
        break;
      case 'chaos':
        this.tone(110, 0.5, 'sawtooth', 0.25, 0, 220);
        this.tone(55, 0.6, 'sine', 0.6);
        break;
      case 'near': {
        const now = this.ctx!.currentTime;
        if (now - this.lastNear < 0.06) return;
        this.lastNear = now;
        this.tone(1200 + Math.random() * 400, 0.06, 'sine', 0.3);
        break;
      }
      case 'pass':
        this.tone(990, 0.1, 'triangle', 0.35);
        this.tone(1320, 0.12, 'triangle', 0.3, 0.06);
        break;
      case 'combo':
        this.tone(523, 0.08, 'triangle', 0.4);
        this.tone(784, 0.14, 'triangle', 0.4, 0.07);
        break;
      case 'glitch':
        this.tone(200, 0.05, 'square', 0.15, 0, 900);
        break;
      case 'death':
        this.noise(0.45, 0.6);
        this.tone(160, 0.6, 'sawtooth', 0.4, 0, 40);
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.45, i * 0.09));
        break;
      case 'unlock':
        this.tone(1047, 0.25, 'sine', 0.45);
        this.tone(1568, 0.35, 'sine', 0.3, 0.08);
        break;
      case 'hover': {
        const now = this.ctx!.currentTime;
        if (now - this.lastHover < 0.05) return;
        this.lastHover = now;
        this.tone(1760, 0.03, 'sine', 0.08);
        break;
      }
      case 'whoosh':
        this.noise(0.35, 0.25, 400, 3200);
        break;
      case 'boot':
        this.tone(55, 1.4, 'sawtooth', 0.35, 0, 110);
        this.tone(110, 1.2, 'triangle', 0.3, 0.15, 220);
        [440, 554, 659, 880].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.25, 0.5 + i * 0.08));
        this.noise(0.8, 0.2, 200, 4000);
        break;
      case 'orb':
        this.tone(880, 0.09, 'sine', 0.45);
        this.tone(1320, 0.16, 'sine', 0.4, 0.05);
        this.tone(1760, 0.22, 'triangle', 0.2, 0.1);
        break;
      case 'bossHit':
        this.noise(0.3, 0.5, 300, 300);
        this.tone(220, 0.4, 'square', 0.3, 0, 70);
        this.tone(660, 0.3, 'triangle', 0.3, 0.05);
        break;
      case 'beam':
        this.tone(140, 1.2, 'sawtooth', 0.25, 0, 70);
        break;
      case 'levelup':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.4, i * 0.07));
        this.tone(2093, 0.6, 'sine', 0.2, 0.35);
        break;
    }
  }

  private startAmbient(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.ambient) return;
    try {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 2.5);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 600;
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.07;
      lfoGain.gain.value = 380;
      lfo.connect(lfoGain).connect(filter.frequency);
      const nodes: AudioScheduledSourceNode[] = [lfo];
      for (const [f, type, detune] of [[55, 'sawtooth', -6], [82.4, 'sawtooth', 5], [110, 'triangle', 0], [164.8, 'sine', 3]] as const) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = f;
        osc.detune.value = detune;
        const g = ctx.createGain();
        g.gain.value = type === 'sine' ? 0.25 : 0.12;
        osc.connect(g).connect(filter);
        nodes.push(osc);
      }
      filter.connect(gain).connect(this.musicBus ?? this.master);
      nodes.forEach((n) => n.start());
      this.ambient = { gain, nodes };
    } catch {
      this.ambient = null;
    }
  }

  private stopAmbient(): void {
    const ctx = this.ctx;
    const amb = this.ambient;
    if (!ctx || !amb) return;
    this.ambient = null;
    try {
      amb.gain.gain.cancelScheduledValues(ctx.currentTime);
      amb.gain.gain.setValueAtTime(Math.max(0.0001, amb.gain.gain.value), ctx.currentTime);
      amb.gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
      amb.nodes.forEach((n) => n.stop(ctx.currentTime + 0.7));
    } catch {
      // already stopped
    }
  }

  /** Number of live music loops (for tests: must never exceed 1). */
  get ambientLoops(): number {
    return this.ambient ? 1 : 0;
  }

  private tone(freq: number, dur: number, type: Wave, vol: number, delay = 0, slideTo?: number): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.sfxBus ?? this.master!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol: number, from = 900, to = 900): void {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(from, ctx.currentTime);
    if (to !== from) filter.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + dur);
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter).connect(gain).connect(this.sfxBus ?? this.master!);
    src.start();
  }
}
