// Client-side prediction for a co-op guest's OWN spacecraft (P2.5).
//
// The host is the authority for everything. A guest's ship, though, would otherwise answer the stick a
// full network round trip late. So the guest flies a private copy of its own ship with the same flight
// model the host uses (sim.flyPilot), from the same controls it sends. When a snapshot arrives with the
// host's position and which input the host had been applying (and for how long), the guest restarts
// from the host's position and replays the controls the host has not applied yet. The difference
// between the old and new prediction is faded out over about a tenth of a second instead of snapping.
//
// Only movement and heading are predicted. Shots, hits, damage, enemies, objectives and results are
// never predicted: they are drawn as the host reports them.

import { flyPilot, leashPilot, type MissionInput, type MissionState, type Pilot } from '../mission/sim';

/** A snapshot's acknowledgement for one pilot: the input sequence number the host was applying, and for how many seconds. */
export type InputAck = [seq: number, appliedFor: number];

interface Frame {
  seq: number;
  input: MissionInput;
  dt: number;
}

/** Corrections bigger than this snap straight to the host's position (a knock-back, a respawn). */
export const SNAP_DISTANCE = 120;
/** How fast a correction fades out (seconds to ~37%). */
export const CORRECTION_TAU = 0.1;
const MAX_FRAMES = 240; // 4 s of history at 60 fps: more than any round trip worth predicting

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Predictor {
  private frames: Frame[] = [];
  private pose: Pilot | null = null;
  private off = { x: 0, y: 0, a: 0 };
  /** Last correction size (units), for tests and diagnostics. */
  lastCorrection = 0;

  get active(): boolean {
    return this.pose !== null;
  }

  reset(): void {
    this.frames = [];
    this.pose = null;
    this.off = { x: 0, y: 0, a: 0 };
  }

  /** Can this pilot be predicted right now? (Not when downed, offline, paused or once the operation ends.) */
  private live(m: MissionState, slot: number, paused: boolean): Pilot | null {
    const p = m.ships[slot];
    return p && p.online && !p.downed && m.status === 'playing' && !paused ? p : null;
  }

  /** One local frame: fly the private copy with the controls the host will apply (the last ones sent). */
  frame(m: MissionState, slot: number, seq: number, input: MissionInput, dt: number, paused = false): void {
    const p = this.live(m, slot, paused);
    if (!p) return this.reset();
    if (!this.pose) this.pose = { ...p };
    this.frames.push({ seq, input: { x: input.x, y: input.y }, dt });
    if (this.frames.length > MAX_FRAMES) this.frames.splice(0, this.frames.length - MAX_FRAMES);
    this.fly(m, this.pose, input, dt);
    const k = Math.exp(-dt / CORRECTION_TAU);
    this.off.x *= k;
    this.off.y *= k;
    this.off.a *= k;
  }

  /**
   * A snapshot has just been applied to `m`: restart from the host's state of this pilot and replay the
   * controls it has not applied yet (everything after `ack`'s input, plus the part of `ack`'s input the
   * host has not run for as long as this guest has).
   */
  reconcile(m: MissionState, slot: number, ack: InputAck | null, paused = false): void {
    const p = this.live(m, slot, paused);
    if (!p || !ack || !this.pose) return this.reset();
    const [seq, appliedFor] = ack;
    const before = { x: this.pose.x + this.off.x, y: this.pose.y + this.off.y, a: this.pose.angle + this.off.a };
    let skip = Math.max(0, appliedFor);
    const keep: Frame[] = [];
    for (const f of this.frames) {
      if (f.seq < seq) continue; // the host has moved past these
      if (f.seq === seq && skip > 0) {
        // The host has already run this input for `appliedFor` seconds: replay only what is left of it.
        const used = Math.min(f.dt, skip);
        skip -= used;
        if (f.dt - used > 1e-6) keep.push({ ...f, dt: f.dt - used });
        continue;
      }
      keep.push(f);
    }
    this.frames = keep;
    const pose: Pilot = { ...p };
    for (const f of keep) this.fly(m, pose, f.input, f.dt);
    this.pose = pose;
    const dx = before.x - pose.x;
    const dy = before.y - pose.y;
    this.lastCorrection = Math.hypot(dx, dy);
    if (this.lastCorrection > SNAP_DISTANCE) this.off = { x: 0, y: 0, a: 0 };
    else this.off = { x: dx, y: dy, a: wrap(before.a - pose.angle) };
  }

  /** The host's flight for one pilot: fly, then the squadron leash (the other pilots as last reported). */
  private fly(m: MissionState, p: Pilot, input: MissionInput, dt: number): void {
    flyPilot(m, p, input, dt);
    if (m.ships.length > 1) leashPilot(m, p);
  }

  /** Write the shown position and heading of this pilot into the mission, for drawing. */
  apply(m: MissionState, slot: number): void {
    const p = m.ships[slot];
    if (!p || !this.pose) return;
    p.x = this.pose.x + this.off.x;
    p.y = this.pose.y + this.off.y;
    p.angle = this.pose.angle + this.off.a;
    p.vx = this.pose.vx;
    p.vy = this.pose.vy;
    p.thrust = this.pose.thrust;
  }
}
