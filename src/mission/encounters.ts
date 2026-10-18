// Scripted encounters: the mission decides when, where and how many enemies appear.
//
// An encounter is a finite set of enemy waves (or a small, explicitly budgeted ambient raid) with a
// trigger, an entry direction, a formation, an optional "incoming" warning and a clear condition.
// Phases name the encounters that must be cleared before they can complete (`Phase.clear`), so
// combat feeds the operation instead of running beside it. Enemies never spawn outside an encounter,
// except what an objective structure itself launches (the hive carrier's brood, which belongs to the
// hive's encounter, and the Guardian's shield generators).
//
// Pure and deterministic like the rest of the mission sim: spawn positions are worked out when a
// wave is announced, and drones are created through the sim's own spawn hook (seeded RNG).

import type { AnyMissionId, Drone, DroneKind, MissionDef, MissionState, Vec } from './sim';

/** How a group is laid out around its anchor, relative to the direction it enters from. */
export type Formation = 'point' | 'line' | 'vee' | 'column' | 'arc' | 'ring';
/** Which screen edge a group enters from ('here' = it warps in at its anchor). */
export type Entry = 'north' | 'south' | 'east' | 'west' | 'here';
export type Where = Vec | ((m: MissionState) => Vec);

export interface Group {
  kind: DroneKind;
  count: number;
  at: Where; // formation centre (where the group is heading)
  formation?: Formation; // default 'line'
  from?: Entry; // default 'here'
  spacing?: number; // default 70 (ring: radius)
  /** Who the group goes for. Default: the kind's own habit (raiders hunt friendly ships). 'carrier': whoever carries the data core (co-op). */
  target?: 'player' | 'ally' | 'carrier';
  /** Co-op: extra enemies in this group for each pilot beyond two (rounded down). */
  extraPerPilot?: number;
}

export interface Wave {
  groups: Group[];
  delay?: number; // world seconds after the previous wave is cleared (default 1.2)
  callout?: string; // radio call when this wave is announced
}

export type Trigger =
  | { on: 'start'; delay?: number }
  | { on: 'phase'; phase: string; delay?: number } // when that phase begins (or any later one)
  | { on: 'cleared'; encounter: string; delay?: number }
  | { on: 'area'; x: number; y: number; r: number; who?: 'ship' | 'ally'; delay?: number }
  | { on: 'flag'; flag: string; delay?: number }
  | { on: 'when'; test: (m: MissionState) => boolean; delay?: number };

/** A trickle of single enemies with a hard budget. Endless (budget Infinity) only in arcade missions. */
export interface Ambient {
  budget: number;
  every: number; // world seconds between spawns
  maxAlive: number; // never more than this many of its enemies at once
  kinds: DroneKind[];
  escalate?: number; // arcade: the interval is multiplied by this after every spawn
  floor?: number; // arcade: the shortest interval escalation can reach
}

export interface EncounterDef {
  id: string;
  name: string; // shown on the HUD ("Raider wing")
  trigger: Trigger;
  waves?: Wave[];
  ambient?: Ambient;
  warn?: number; // world seconds of "incoming" markers before each wave arrives (default 0)
  callout?: string; // radio call when the first wave is announced
  tag?: string; // objective group: counted by phases (`${tag}Total`) and marked on screen
  until?: string; // phase id: once that phase is complete the encounter sends nothing more
}

export type EncounterStatus = 'idle' | 'pending' | 'warning' | 'active' | 'cleared' | 'cancelled';

export interface Incoming {
  kind: DroneKind;
  x: number; // where it will appear
  y: number;
  vx: number; // initial velocity (flying in from its entry edge)
  vy: number;
  from: Entry;
  target?: 'player' | 'ally' | 'carrier';
}

export interface EncounterState {
  id: string;
  status: EncounterStatus;
  wave: number; // index of the current (or next) wave
  timer: number; // pending delay or warning time left (world seconds)
  spawned: number;
  total: number; // enemies this encounter will send (Infinity for endless ambient)
  ambientLeft: number;
  ambientNext: number;
  ambientEvery: number;
  stopped: boolean; // `until` reached: nothing more will spawn
  incoming: Incoming[]; // the announced wave, during 'warning'
}

/** What the encounter runner needs from the sim (kept as hooks so this module has no runtime import of it). */
export interface EncounterHooks {
  spawn: (kind: DroneKind, x: number, y: number) => Drone;
  comms: (text: string, alert: boolean) => void;
  livingAllies: () => { id: number; x: number; y: number }[];
}

const DEFAULT_SPACING = 70;
const DEFAULT_WAVE_DELAY = 1.2;
const ENTRY_SPEED = 160;
const VIEW = 720;

const DIR: Record<Entry, Vec> = { north: { x: 0, y: 1 }, south: { x: 0, y: -1 }, east: { x: -1, y: 0 }, west: { x: 1, y: 0 }, here: { x: 0, y: 1 } };

export const ENTRY_LABEL: Record<Entry, string> = { north: 'north', south: 'south', east: 'east', west: 'west', here: 'close' };

const resolveWhere = (m: MissionState, w: Where): Vec => (typeof w === 'function' ? w(m) : w);

const defOf = (m: MissionState, id: string): EncounterDef | undefined => m.def.encounters?.find((e) => e.id === id);

export const encounterState = (m: MissionState, id: string): EncounterState | undefined => m.encounters.find((e) => e.id === id);

/** Living enemies that belong to an encounter (its waves, its ambient raiders, anything it launches). */
export const aliveOf = (m: MissionState, id: string): number => m.drones.filter((d) => d.enc === id && d.hp > 0).length;

/** How many enemies a group sends with `pilots` pilots in the mission (solo and two-pilot co-op: its count). */
export const groupCount = (g: Group, pilots = 1) => g.count + Math.floor((g.extraPerPilot ?? 0) * Math.max(0, pilots - 2));

/** Total enemies an encounter will send: every wave's groups, plus its ambient budget. */
export function encounterTotal(def: EncounterDef, pilots = 1): number {
  const waves = (def.waves ?? []).reduce((n, w) => n + w.groups.reduce((k, g) => k + groupCount(g, pilots), 0), 0);
  return waves + (def.ambient?.budget ?? 0);
}

export function initEncounters(def: MissionDef<AnyMissionId>, pilots = 1): EncounterState[] {
  return (def.encounters ?? []).map((e) => ({
    id: e.id,
    status: 'idle',
    wave: 0,
    timer: 0,
    spawned: 0,
    total: encounterTotal(e, pilots),
    ambientLeft: e.ambient?.budget ?? 0,
    ambientNext: 0,
    ambientEvery: e.ambient?.every ?? 0,
    stopped: false,
    incoming: [],
  }));
}

/** Formation offsets in local axes: `f` is the direction of travel, `s` is to its side. */
function layout(g: Group, n: number): { side: number; fwd: number }[] {
  const sp = g.spacing ?? DEFAULT_SPACING;
  const out: { side: number; fwd: number }[] = [];
  for (let i = 0; i < n; i++) {
    const k = i - (n - 1) / 2;
    switch (g.formation ?? 'line') {
      case 'point':
        out.push({ side: k * 24, fwd: 0 });
        break;
      case 'line':
        out.push({ side: k * sp, fwd: 0 });
        break;
      case 'vee': {
        // Leader in front, wings swept back.
        const wing = Math.ceil(i / 2) * (i % 2 ? -1 : 1);
        out.push({ side: wing * sp, fwd: -Math.abs(wing) * sp * 0.7 });
        break;
      }
      case 'column':
        out.push({ side: 0, fwd: -i * sp });
        break;
      case 'arc': {
        const a = n > 1 ? (k / ((n - 1) / 2)) * 0.9 : 0;
        out.push({ side: Math.sin(a) * sp * 2, fwd: -(1 - Math.cos(a)) * sp * 2 });
        break;
      }
      case 'ring': {
        const a = (i / n) * Math.PI * 2;
        out.push({ side: Math.cos(a) * sp, fwd: Math.sin(a) * sp });
        break;
      }
    }
  }
  return out;
}

/** Where each enemy of a wave appears: its formation, pushed back beyond the screen edge it enters from. */
export function planWave(m: MissionState, wave: Wave): Incoming[] {
  const out: Incoming[] = [];
  const W = m.def.world.w;
  const H = m.def.world.h;
  for (const g of wave.groups) {
    const from = g.from ?? 'here';
    const f = DIR[from];
    const s = { x: -f.y, y: f.x };
    const c = resolveWhere(m, g.at);
    // How far back along the entry direction the group starts: just outside the visible window.
    let back = 0;
    if (from === 'north') back = Math.max(0, c.y - (m.camY - 70));
    else if (from === 'south') back = Math.max(0, m.camY + VIEW + 70 - c.y);
    else if (from === 'west') back = Math.max(0, c.x - (m.camX - 70));
    else if (from === 'east') back = Math.max(0, m.camX + VIEW + 70 - c.x);
    for (const o of layout(g, groupCount(g, m.ships.length))) {
      let x = c.x + s.x * o.side + f.x * (o.fwd - back);
      let y = c.y + s.y * o.side + f.y * (o.fwd - back);
      x = Math.max(40, Math.min(W - 40, x));
      y = Math.max(40, Math.min(H - 40, y));
      // Never on top of a pilot.
      for (const s of m.ships) {
        if (!s.online || s.downed) continue;
        const dx = x - s.x;
        const dy = y - s.y;
        const d = Math.hypot(dx, dy);
        if (d < 150) {
          const k = d > 1 ? 150 / d : 1;
          x = Math.max(40, Math.min(W - 40, s.x + (d > 1 ? dx * k : 150)));
          y = Math.max(40, Math.min(H - 40, s.y + (d > 1 ? dy * k : 0)));
        }
      }
      const moving = from !== 'here';
      out.push({ kind: g.kind, x, y, vx: moving ? f.x * ENTRY_SPEED : 0, vy: moving ? f.y * ENTRY_SPEED : 0, from, target: g.target });
    }
  }
  return out;
}

const phaseIndex = (m: MissionState, id: string) => m.def.phases.findIndex((p) => p.id === id);

function triggered(m: MissionState, t: Trigger, hooks: EncounterHooks): boolean {
  switch (t.on) {
    case 'start':
      return true;
    case 'phase': {
      const i = phaseIndex(m, t.phase);
      return i >= 0 && m.phase >= i;
    }
    case 'cleared':
      return encounterState(m, t.encounter)?.status === 'cleared';
    case 'area':
      if (t.who === 'ally') return hooks.livingAllies().some((a) => Math.hypot(a.x - t.x, a.y - t.y) < t.r);
      return m.ships.some((s) => s.online && !s.downed && Math.hypot(s.x - t.x, s.y - t.y) < t.r);
    case 'flag':
      return !!m.flags[t.flag];
    case 'when':
      return t.test(m);
  }
}

function spawnOne(st: EncounterState, def: EncounterDef, p: Incoming, hooks: EncounterHooks): void {
  const d = hooks.spawn(p.kind, p.x, p.y);
  d.enc = st.id;
  if (def.tag) d.tag = def.tag;
  d.vx = p.vx;
  d.vy = p.vy;
  if (p.target === 'player') d.targetAlly = null;
  else if (p.target === 'carrier') {
    d.targetAlly = null;
    d.hunt = 'carrier';
  } else if (p.target === 'ally') {
    const l = hooks.livingAllies();
    if (l.length) d.targetAlly = l[st.spawned % l.length].id;
  }
  st.spawned++;
}

/** Announce the next wave (warning markers and a callout), or send it straight in if it has no warning. */
function announce(m: MissionState, st: EncounterState, def: EncounterDef, hooks: EncounterHooks): void {
  const wave = def.waves![st.wave];
  st.incoming = planWave(m, wave);
  const callout = wave.callout ?? (st.wave === 0 ? def.callout : undefined);
  if (callout) hooks.comms(callout, true);
  const first = st.incoming[0];
  m.events.push({ type: 'incoming', id: def.id, name: def.name, from: first?.from ?? 'here', x: first?.x ?? m.ship.x, y: first?.y ?? m.ship.y });
  if ((def.warn ?? 0) > 0) {
    st.status = 'warning';
    st.timer = def.warn!;
  } else arrive(st, def, hooks);
}

function arrive(st: EncounterState, def: EncounterDef, hooks: EncounterHooks): void {
  for (const p of st.incoming) spawnOne(st, def, p, hooks);
  st.incoming = [];
  st.status = 'active';
}

function begin(m: MissionState, st: EncounterState, def: EncounterDef, hooks: EncounterHooks): void {
  if (def.tag) m.flags[`${def.tag}Total`] = (m.flags[`${def.tag}Total`] ?? 0) + st.total;
  if (def.ambient) {
    st.status = 'active';
    st.ambientNext = 0;
    if (def.callout) hooks.comms(def.callout, false);
    return;
  }
  announce(m, st, def, hooks);
}

function finish(m: MissionState, st: EncounterState, def: EncounterDef): void {
  st.status = 'cleared';
  st.incoming = [];
  m.events.push({ type: 'encounter-clear', id: def.id, name: def.name });
}

/** Start an encounter now, whatever its trigger (used when a phase is waiting on it). Never starts one twice. */
export function forceEncounter(m: MissionState, id: string): void {
  const st = encounterState(m, id);
  if (st && st.status === 'idle') {
    st.status = 'pending';
    st.timer = 0;
  }
}

/**
 * A phase is ready to move on but still waits on encounters. Start the next one that has not begun, but
 * only while none of them is already being fought: the fights it waits for come one at a time, and one
 * whose trigger depends on another's clearing gets its natural chance first.
 */
export function startWaitingFight(m: MissionState, clear: readonly string[] | undefined): void {
  const waiting = blockingEncounters(m, clear);
  if (!waiting.length || waiting.some((s) => s.status !== 'idle')) return;
  forceEncounter(m, waiting[0].id);
}

/** Advance every encounter by `wdt` world seconds. */
export function updateEncounters(m: MissionState, wdt: number, hooks: EncounterHooks): void {
  for (const st of m.encounters) {
    const def = defOf(m, st.id);
    if (!def || st.status === 'cleared' || st.status === 'cancelled') continue;

    // `until`: once that phase is done, the encounter sends nothing more.
    if (def.until && !st.stopped) {
      const i = phaseIndex(m, def.until);
      if (i >= 0 && m.phase > i) {
        st.stopped = true;
        st.ambientLeft = 0;
        if (st.status === 'idle' || st.status === 'pending' || st.status === 'warning') {
          st.status = 'cancelled';
          st.incoming = [];
          continue;
        }
      }
    }

    if (st.status === 'idle') {
      // State-based triggers: an encounter fires once, the first step its condition holds.
      if (!triggered(m, def.trigger, hooks)) continue;
      st.status = 'pending';
      st.timer = def.trigger.delay ?? 0;
    }
    if (st.status === 'pending') {
      st.timer -= wdt;
      if (st.timer > 0) continue;
      if (st.spawned === 0 && st.wave === 0) begin(m, st, def, hooks);
      else announce(m, st, def, hooks);
      continue;
    }
    if (st.status === 'warning') {
      st.timer -= wdt;
      if (st.timer <= 0) arrive(st, def, hooks);
      continue;
    }
    // Active.
    const alive = aliveOf(m, st.id);
    if (def.ambient) {
      const a = def.ambient;
      if (st.ambientLeft > 0) {
        st.ambientNext -= wdt;
        if (st.ambientNext <= 0 && alive < a.maxAlive) {
          spawnAmbient(m, st, def, hooks);
          st.ambientLeft--;
          if (a.escalate) st.ambientEvery = Math.max(a.floor ?? 0.5, st.ambientEvery * a.escalate);
          st.ambientNext = st.ambientEvery * (0.8 + m.rng() * 0.4);
        }
      } else if (alive === 0) finish(m, st, def);
      continue;
    }
    if (alive > 0) continue;
    st.wave++;
    if (!st.stopped && st.wave < def.waves!.length) {
      st.status = 'pending';
      st.timer = def.waves![st.wave].delay ?? DEFAULT_WAVE_DELAY;
    } else finish(m, st, def);
  }
}

/** One ambient raider, from just outside the view on a random side. */
function spawnAmbient(m: MissionState, st: EncounterState, def: EncounterDef, hooks: EncounterHooks): void {
  const a = def.ambient!;
  const kind = a.kinds[Math.floor(m.rng() * a.kinds.length)];
  const ang = m.rng() * Math.PI * 2;
  const cx = m.camX + VIEW / 2;
  const cy = m.camY + VIEW / 2;
  const x = Math.max(30, Math.min(m.def.world.w - 30, cx + Math.cos(ang) * VIEW * 0.62));
  const y = Math.max(30, Math.min(m.def.world.h - 30, cy + Math.sin(ang) * VIEW * 0.62));
  spawnOne(st, def, { kind, x, y, vx: -Math.cos(ang) * ENTRY_SPEED, vy: -Math.sin(ang) * ENTRY_SPEED, from: 'here' }, hooks);
}

/** Encounters a phase still waits on (the ones it names in `clear` that are not cleared yet). */
export function blockingEncounters(m: MissionState, clear: readonly string[] | undefined): EncounterState[] {
  if (!clear) return [];
  // An encounter missing from the state (none scripted, e.g. a stripped-down test range) blocks nothing.
  return clear.map((id) => encounterState(m, id)).filter((s): s is EncounterState => !!s && s.status !== 'cleared' && s.status !== 'cancelled');
}

export interface ContactView {
  name: string;
  state: 'inbound' | 'engaged';
  left: number; // enemies of this encounter still to destroy (alive + not yet arrived)
  from: Entry | null;
  required: boolean; // the current phase waits on it
}

/** The encounter the HUD should talk about: the current phase's own first, then anything inbound. */
export function contactView(m: MissionState, clear: readonly string[] | undefined): ContactView | null {
  const req = blockingEncounters(m, clear).filter((s) => s.status !== 'idle');
  const live = m.encounters.filter((s) => s.status === 'warning' || s.status === 'active' || s.status === 'pending');
  const pick = req.find((s) => s.status === 'warning' || s.status === 'active') ?? live.find((s) => s.status === 'warning') ?? req[0] ?? live.find((s) => s.status === 'active' && aliveOf(m, s.id) > 0);
  if (!pick) return null;
  const def = defOf(m, pick.id)!;
  const alive = aliveOf(m, pick.id);
  const unsent = Number.isFinite(pick.total) && !pick.stopped ? pick.total - pick.spawned : 0;
  return {
    name: def.name,
    state: pick.status === 'warning' || (pick.status === 'pending' && alive === 0) ? 'inbound' : 'engaged',
    left: def.ambient && !Number.isFinite(pick.total) ? alive : alive + unsent,
    from: pick.status === 'warning' ? (pick.incoming[0]?.from ?? null) : null,
    required: req.includes(pick),
  };
}

/** Kills (or other removals) out of the total for an encounter, for objective counters. */
export function encounterProgress(m: MissionState, id: string): { done: number; total: number } {
  const st = encounterState(m, id);
  if (!st) return { done: 0, total: 0 };
  return { done: st.spawned - aliveOf(m, id), total: st.total };
}

/**
 * Static checks that make a mission's script safe: unique ids, triggers that point at real phases and
 * encounters, no endless enemies outside arcade missions, and every encounter a phase waits on is
 * finite and can always start. Returns a list of problems (empty = sound).
 */
export function validateEncounters(def: MissionDef<AnyMissionId>): string[] {
  const errs: string[] = [];
  const encs = def.encounters ?? [];
  const ids = new Set<string>();
  for (const e of encs) {
    if (ids.has(e.id)) errs.push(`duplicate encounter id ${e.id}`);
    ids.add(e.id);
    if (!e.waves?.length && !e.ambient) errs.push(`${e.id}: no waves and no ambient budget`);
    if (e.waves?.some((w) => !w.groups.length || w.groups.some((g) => g.count < 1))) errs.push(`${e.id}: an empty wave or group`);
    if (e.ambient && !Number.isFinite(e.ambient.budget) && !def.arcade) errs.push(`${e.id}: endless ambient enemies outside an arcade mission`);
    if (e.ambient && !(e.ambient.maxAlive >= 1)) errs.push(`${e.id}: ambient maxAlive must be at least 1`);
    const t = e.trigger;
    if (t.on === 'phase' && !def.phases.some((p) => p.id === t.phase)) errs.push(`${e.id}: trigger names unknown phase ${t.phase}`);
    if (t.on === 'cleared' && !encs.some((x) => x.id === t.encounter)) errs.push(`${e.id}: trigger names unknown encounter ${t.encounter}`);
    if (e.until && !def.phases.some((p) => p.id === e.until)) errs.push(`${e.id}: until names unknown phase ${e.until}`);
  }
  def.phases.forEach((p) => {
    for (const id of p.clear ?? []) {
      const e = encs.find((x) => x.id === id);
      if (!e) {
        errs.push(`phase ${p.id} waits on unknown encounter ${id}`);
        continue;
      }
      if (!Number.isFinite(encounterTotal(e))) errs.push(`phase ${p.id} waits on endless encounter ${id}`);
      if (e.until) errs.push(`phase ${p.id} waits on ${id}, which can be cancelled by until`);
      if (e.trigger.on === 'cleared') {
        const dep = e.trigger.encounter;
        const reachable = def.phases.some((q) => q.clear?.includes(dep)) || encs.find((x) => x.id === dep)?.trigger.on !== 'cleared';
        if (!reachable) errs.push(`phase ${p.id} waits on ${id}, which depends on an encounter that may never clear`);
      }
    }
  });
  return errs;
}
