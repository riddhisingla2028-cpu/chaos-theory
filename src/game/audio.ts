// Tiny synthesized sound effects via the Web Audio API. No audio files, no dependencies.
// The context is created on the first user gesture, as browsers require.

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

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastNear = 0;
  private lastHover = 0;
  private ambient: { gain: GainNode; nodes: AudioScheduledSourceNode[] } | null = null;
  muted = false;

  unlock(): void {
    try {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') void this.ctx.resume();
        return;
      }
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.16;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null; // audio unavailable: play silently
    }
  }

  play(name: SoundName): void {
    if (this.muted || !this.ctx || !this.master || this.ctx.state !== 'running') return;
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
        const now = this.ctx.currentTime;
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
        const now = this.ctx.currentTime;
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

  /** Low ambient pad for the menus. Safe to call repeatedly. */
  setAmbient(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    if (on && !this.muted && !this.ambient && ctx.state === 'running') {
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
      filter.connect(gain).connect(this.master);
      nodes.forEach((n) => n.start());
      this.ambient = { gain, nodes };
    } else if ((!on || this.muted) && this.ambient) {
      const { gain, nodes } = this.ambient;
      this.ambient = null;
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
      nodes.forEach((n) => n.stop(ctx.currentTime + 0.9));
    }
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
    osc.connect(gain).connect(this.master!);
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
    src.connect(filter).connect(gain).connect(this.master!);
    src.start();
  }
}
