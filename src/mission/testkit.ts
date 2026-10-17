// Test helpers for mission simulations: scripted pilots that fly and fire through the same input the
// player uses ({ x, y, fire }). Imported only by tests; never part of the game bundle.

import { stepMission, type Drone, type MissionState, type Vec } from './sim';

export const DT = 1 / 60;

/** Remove hazards so a route test checks only objectives and geometry. Objective debris is kept. */
export function calm(m: MissionState): void {
  m.rocks = m.rocks.filter((r) => r.tag);
  m.rockSpawn = null;
  m.barriers = [];
  m.pulses = [];
  m.pulseEvery = 0;
  m.bullets = m.bullets.filter((b) => b.from === 'player');
  m.chrono.nextSpawn = Infinity;
  m.chrono.pickup = null;
}

/** Steer straight at a (possibly moving) target until close, the mission ends, or time runs out. */
export function flyTo(m: MissionState, target: Vec | (() => Vec), opts: { within?: number; maxT?: number; calmWorld?: boolean } = {}): boolean {
  const within = opts.within ?? 18;
  const end = m.realTime + (opts.maxT ?? 20);
  while (m.status === 'playing' && m.realTime < end) {
    if (opts.calmWorld !== false) calm(m);
    const t = typeof target === 'function' ? target() : target;
    const dx = t.x - m.ship.x;
    const dy = t.y - m.ship.y;
    const d = Math.hypot(dx, dy);
    if (d < within) return true;
    stepMission(m, { x: dx / d, y: dy / d }, DT);
  }
  return false;
}

export function hold(m: MissionState, seconds: number, calmWorld = true): void {
  const end = m.realTime + seconds;
  while (m.status === 'playing' && m.realTime < end) {
    if (calmWorld) calm(m);
    stepMission(m, { x: 0, y: 0 }, DT);
  }
}

/**
 * One step of a gunnery pilot against `t`: close to `range`, then turn the nose onto the target with a
 * gentle input (which barely moves the ship) and fire only while the game reports the target in the
 * line of fire. No positions are moved by hand.
 */
export function attackStep(m: MissionState, t: Vec & { id?: number }, range = 230, targetId?: number): void {
  const dx = t.x - m.ship.x;
  const dy = t.y - m.ship.y;
  const d = Math.hypot(dx, dy) || 1;
  const k = d > range ? 1 : 0.07;
  const inSights = targetId === undefined ? m.target !== null : m.target === targetId;
  stepMission(m, { x: (dx / d) * k, y: (dy / d) * k, fire: inSights }, DT);
}

/** Shoot at a target until `gone()` or time runs out. Returns true if it was destroyed. */
export function shootDown(m: MissionState, target: () => (Vec & { id?: number }) | null, gone: () => boolean, maxT = 20, calmWorld = true): boolean {
  const end = m.realTime + maxT;
  while (m.status === 'playing' && m.realTime < end && !gone()) {
    if (calmWorld) calm(m);
    const t = target();
    if (!t) stepMission(m, { x: 0, y: 0 }, DT);
    else attackStep(m, t);
  }
  return gone();
}

/**
 * An invulnerable combat pilot for escort and defence missions: hunts objective targets first, then
 * whatever is closest to a friendly ship (or itself), and fires only when something is in its sights.
 * Invulnerable so the test checks the mission rules, not the pilot's dodging.
 */
export function combatPilot(m: MissionState): void {
  m.ship.invuln = 5;
  const allies = m.allies.filter((a) => !a.destroyed);
  const anchors: Vec[] = allies.length ? allies : [m.ship];
  const near = (d: Drone) => Math.min(...anchors.map((a) => Math.hypot(d.x - a.x, d.y - a.y)));
  const live = m.drones.filter((d) => d.spawnIn === 0 && d.hp > 0);
  const priority = live.filter((d) => d.tag && d.tag !== 'brood');
  const pool = priority.length ? priority : live;
  const threat = pool.sort((a, b) => near(a) - near(b))[0];
  if (threat) attackStep(m, threat, 200);
  else {
    const g = allies[0] ?? m.ship;
    const dx = g.x - m.ship.x;
    const dy = g.y + 90 - m.ship.y;
    const d = Math.hypot(dx, dy);
    stepMission(m, d > 20 ? { x: dx / d, y: dy / d } : { x: 0, y: 0 }, DT);
  }
}
