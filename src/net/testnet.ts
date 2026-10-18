// An in-memory network for unit tests (the browser uses PeerJS/WebRTC). Messages are JSON-copied and
// delivered asynchronously, like a real data channel. Imported only by tests.

import type { Conn } from './room';

export function pipe(): [Conn, Conn] {
  const make = () => ({ data: [] as ((m: unknown) => void)[], close: [] as (() => void)[], open: true });
  const a = make();
  const b = make();
  const end = (me: typeof a, other: typeof a): Conn => ({
    send: (m) => {
      if (!me.open) return;
      const copy = JSON.parse(JSON.stringify(m));
      queueMicrotask(() => other.open && other.data.forEach((f) => f(copy)));
    },
    close: () => {
      if (!me.open) return;
      me.open = other.open = false;
      queueMicrotask(() => [...a.close, ...b.close].forEach((f) => f()));
    },
    onData: (f) => me.data.push(f),
    onClose: (f) => me.close.push(f),
  });
  return [end(a, b), end(b, a)];
}

export const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

// ---------- A deterministic network with latency, jitter, stalls and (optionally) loss ----------

/** A manual clock: nothing happens until a test advances it. */
export class NetClock {
  now = 0; // ms
  private queue: { at: number; seq: number; fn: () => void }[] = [];
  private seq = 0;
  schedule(atMs: number, fn: () => void): void {
    this.queue.push({ at: atMs, seq: this.seq++, fn });
    this.queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
  }
  /** Run everything due up to now + ms, in time order. */
  advance(ms: number): void {
    const end = this.now + ms;
    while (this.queue.length && this.queue[0].at <= end) {
      const next = this.queue.shift()!;
      this.now = Math.max(this.now, next.at);
      next.fn();
    }
    this.now = end;
  }
}

export interface LinkOptions {
  /** One-way delay in ms. */
  delay: number;
  /** Extra random delay, 0..jitter ms (seeded). */
  jitter?: number;
  /** Chance per message of a retransmission stall (a reliable channel re-sends a lost packet): adds `stallMs`. */
  stall?: number;
  stallMs?: number;
  /** Unreliable mode only: chance a message is dropped outright. */
  drop?: number;
  /** false (default): ordered, like the game's reliable WebRTC channel. true: messages may overtake each other. */
  unordered?: boolean;
  seed?: number;
}

/**
 * A pair of connected ends over a simulated link. Ordered links never deliver a message before an
 * earlier one (a stall holds up everything behind it, as on a real reliable channel).
 */
export function simLink(clock: NetClock, opts: LinkOptions): [Conn, Conn] {
  let a = (opts.seed ?? 1) >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const make = () => ({ data: [] as ((m: unknown) => void)[], close: [] as (() => void)[], open: true, lastAt: 0 });
  const x = make();
  const y = make();
  const end = (me: typeof x, other: typeof x): Conn => ({
    send: (m) => {
      if (!me.open) return;
      if (opts.unordered && opts.drop && rnd() < opts.drop) return;
      const copy = JSON.parse(JSON.stringify(m));
      let at = clock.now + opts.delay + (opts.jitter ? rnd() * opts.jitter : 0);
      if (opts.stall && rnd() < opts.stall) at += opts.stallMs ?? 200;
      if (!opts.unordered) at = Math.max(at, me.lastAt); // in order: never before the previous message
      me.lastAt = at;
      clock.schedule(at, () => other.open && other.data.forEach((f) => f(copy)));
    },
    close: () => {
      if (!me.open) return;
      me.open = other.open = false;
      clock.schedule(clock.now, () => [...x.close, ...y.close].forEach((f) => f()));
    },
    onData: (f) => me.data.push(f),
    onClose: (f) => me.close.push(f),
  });
  return [end(x, y), end(y, x)];
}
