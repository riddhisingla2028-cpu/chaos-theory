// Test helpers for mission simulations: scripted pilots that fly and fire through the same input the
// player uses ({ x, y, fire }). Imported only by tests; never part of the game bundle.

import { carrierOf, stepMission, type Drone, type MissionInput, type MissionState, type Pilot, type Vec } from './sim';

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

// ---------- Co-op squad (Op. Twin Lock) ----------

/**
 * A scripted squadron for co-op tests: every pilot gets its own input each step, through the same
 * {x, y, fire} the players use. Roles: slots 0 and 1 hold the uplinks; slot 0 carries the data core and
 * the others escort it; at the generators each pilot takes one (two pilots: the outer two, then the
 * centre together), wears it down, and the squad finishes them together. Anyone near a downed teammate
 * stops to revive them. Nothing is moved or killed by hand.
 */
export function coopSquad(m: MissionState): MissionInput[] {
  const phase = m.def.phases[Math.min(m.phase, m.def.phases.length - 1)].id;
  const live = m.drones.filter((d) => d.spawnIn === 0 && d.hp > 0);
  const steer = (p: Pilot, t: Vec, within = 14): MissionInput => {
    const dx = t.x - p.x;
    const dy = t.y - p.y;
    const d = Math.hypot(dx, dy);
    return d < within ? { x: 0, y: 0, fire: p.aimTarget !== null } : { x: dx / d, y: dy / d, fire: p.aimTarget !== null };
  };
  /** Turn onto a target with a gentle input (barely moving) and fire when it is in this pilot's sights. */
  const attack = (p: Pilot, t: Drone, range = 230): MissionInput => {
    const dx = t.x - p.x;
    const dy = t.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const k = d > range ? 1 : 0.07;
    return { x: (dx / d) * k, y: (dy / d) * k, fire: p.aimTarget === t.id, assist: true };
  };
  const nearest = (from: Vec, xs: Drone[]) => xs.slice().sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0];
  const downed = m.ships.filter((p) => p.online && p.downed);

  return m.ships.map((p): MissionInput => {
    if (!p.online || p.downed) return { x: 0, y: 0 };
    // Revive a nearby downed teammate first.
    const fallen = downed.find((q) => Math.hypot(q.x - p.x, q.y - p.y) < 260);
    if (fallen && !(phase === 'core' && carrierOf(m) === p)) return steer(p, fallen, 30);

    if (phase === 'uplinks' && m.uplink) {
      const pad = m.uplink.pads[p.slot];
      if (pad) {
        if (Math.hypot(pad.x - p.x, pad.y - p.y) > 24) return steer(p, pad, 10);
        const t = nearest(p, live.filter((d) => Math.hypot(d.x - p.x, d.y - p.y) < 520));
        return t ? { ...attack(p, t, 9999), x: 0, y: 0 } : { x: 0, y: 0 };
      }
      const t = nearest(p, live);
      return t ? attack(p, t) : steer(p, { x: 500, y: 2650 });
    }

    if (phase === 'core') {
      const core = m.pods.find((x) => x.heavy);
      // Whoever has the core takes it to the bay (anyone who touches it picks it up); slot 0 fetches it when it is loose.
      const carrier = carrierOf(m);
      if (core && (carrier === p || (!carrier && p.slot === 0))) {
        if (core.state === 'drifting') return steer(p, core, 4);
        // Round the central block on its west side, then into the bay.
        const route = [
          { x: 500, y: 2360 },
          { x: 300, y: 2100 },
          { x: 300, y: 1760 },
          { x: 500, y: 1300 },
        ];
        const next = route.find((w) => p.y > w.y + 12) ?? route[route.length - 1];
        return steer(p, next, 8);
      }
      const guard = carrier ?? m.ship;
      const hunters = live.filter((d) => d.hunt === 'carrier' || Math.hypot(d.x - guard.x, d.y - guard.y) < 420);
      const t = nearest(guard, hunters.length ? hunters : live);
      return t ? attack(p, t) : steer(p, { x: guard.x + (p.slot % 2 ? 90 : -90), y: guard.y - 60 }, 30);
    }

    if (phase === 'strike' && m.linked) {
      const L = m.linked;
      const gens = m.drones.filter((d) => d.tag === L.tag).sort((a, b) => a.x - b.x);
      const pilots = m.ships.filter((q) => q.online && !q.downed);
      const n = Math.min(3, pilots.length);
      // Assignment: three or more pilots take one each; two take the outer pair, then the centre together.
      const slotIdx = pilots.indexOf(p);
      const wantX = n >= 3 ? [170, 500, 830][slotIdx] : n === 2 ? [170, 830][slotIdx] : 500;
      let mine = slotIdx < 3 ? gens.find((g) => Math.abs(g.x - (wantX ?? 500)) < 5) : undefined;
      if (!mine && n === 2) mine = gens.find((g) => Math.abs(g.x - 500) < 5);
      if (!mine) {
        const t = nearest(p, live.filter((d) => d.tag !== L.tag));
        return t ? attack(p, t) : steer(p, { x: 500, y: 850 });
      }
      // Stand below it (through the gap between the walls at y 1180), wear it down, then strike together.
      if (p.y > 1220 && Math.abs(p.x - 500) > 140) return steer(p, { x: 500, y: 1150 });
      // Within the generators' shield range (TL_STRIKE_RANGE).
      const station = { x: mine.x + (mine.x < 500 ? 60 : mine.x > 500 ? -60 : 0), y: mine.y + 140 };
      // (A wide tolerance: turning onto the target drifts the ship a little, and must not flip it back.)
      if (Math.hypot(station.x - p.x, station.y - p.y) > 45) return steer(p, station, 12);
      const READY = 3;
      const assigned = n >= 3 ? gens.filter((g) => [170, 500, 830].slice(0, n).some((x) => Math.abs(g.x - x) < 5)) : gens.filter((g) => Math.abs(g.x - 500) > 5);
      const strike = L.firstAt !== null || (assigned.length > 0 && assigned.every((g) => g.hp <= READY));
      const keepDown = mine.hp > READY || (m.time - (mine.lastHitAt ?? -99) > 1.0 && p.fireCd === 0);
      const a = attack(p, mine, 9999);
      return { ...a, x: a.x, y: a.y, fire: a.fire && (strike || keepDown) };
    }

    // Extract: everyone into the portal, firing at anything in the way.
    return steer(p, m.portal ?? { x: 500, y: 180 }, 6);
  });
}
