import type { CSSProperties, ReactNode } from 'react';
import type { DeathCause, GameStats } from '../game/engine';
import { STAGES, TRIALS, endlessMode, objectiveText, starThresholds } from '../game/stages';
import { SKIP_AFTER_FAILS, isEndlessMode, nextUnlockHint, type ModeBest, type Progress, type RunOutcome, type RunSummary } from '../progress';
import { levelFromXp } from '../progression';
import { AdSlot } from './AdSlot';
import { Overlay, Stars } from './common';

export interface Result {
  summary: RunSummary;
  outcome: RunOutcome;
  cause: DeathCause | null;
  stats: GameStats;
  label: string;
  previousTime: number | null; // survival time of the previous attempt at the same mode/level
  boss: { hp: number; maxHp: number } | null;
  phase: { index: number; count: number; name: string } | null;
}

const rgb = (c: [number, number, number]) => `rgb(${c.join(',')})`;

function formatDuration(seconds: number): string {
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function Tile({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`tile${accent ? ' tile-accent' : ''}`}>
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
    </div>
  );
}

const CAUSE_TEXT: Record<DeathCause, string> = {
  drifter: 'Struck by a drifter',
  seeker: 'Hunted down by a seeker',
  collapse: 'Crushed by the walls',
  afterimage: 'Caught in your own afterimage',
  scanline: 'Cut by the scanline',
  horizon: 'Lost beyond the event horizon',
  void: 'Fell into the void',
  timeout: 'Out of time',
  boss: 'Touched the Core',
  beam: 'Burned by the Core’s beam',
  nova: 'Caught by the shockwave',
  fall: 'Fell into the void',
  rotor: 'Swept by a rotor arm',
};

const BEST_LABEL: Record<keyof ModeBest, string> = { score: 'score', time: 'time', orbs: 'orb count', events: 'event count', bosses: 'boss streak' };

/** The three headline numbers for an Endless run, with the matching personal best last. */
function endlessTiles(summary: RunSummary, best: ModeBest): [string, string, boolean][] {
  const sc = summary.score.toLocaleString();
  const time = `${summary.time.toFixed(1)}s`;
  switch (summary.mode) {
    case 'orbrush':
      return [['Orbs', String(summary.orbs ?? 0), true], ['Score', sc, false], ['Best orbs', String(best.orbs), false]];
    case 'chaos':
      return [['Score', sc, true], ['Events', String(summary.events ?? 0), false], ['Best score', best.score.toLocaleString(), false]];
    case 'bossrush':
      return [['Bosses', String(summary.bosses ?? 0), true], ['Score', sc, false], ['Best streak', String(best.bosses), false]];
    default:
      return [['Time', time, true], ['Score', sc, false], ['Best time', `${best.time.toFixed(1)}s`, false]];
  }
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="stats-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** What the run earned: XP (itemised), level progress, challenges, achievements and unlocks. */
function Rewards({ outcome }: { outcome: RunOutcome }) {
  const before = levelFromXp(outcome.xpBefore);
  const after = levelFromXp(outcome.xpBefore + outcome.xpGained);
  const levelled = after.level > before.level;
  const items = [
    ...(levelled ? [{ key: 'lvl', kind: 'Level up', name: `Account level ${after.level}` }] : []),
    ...outcome.challengesCompleted.map((c) => ({ key: `c-${c.def.id}`, kind: c.scope === 'daily' ? 'Daily challenge' : 'Weekly challenge', name: c.def.text })),
    ...outcome.newAchievements.map((a) => ({ key: `a-${a.id}`, kind: 'Achievement', name: a.name })),
    ...outcome.newUnlocks.map((u) => ({ key: `u-${u.kind}-${u.id}`, kind: u.kind === 'shape' ? 'New skin' : 'New theme', name: u.name })),
    ...outcome.newCosmetics.map((c) => ({ key: `k-${c}`, kind: 'Unlocked', name: c })),
  ];
  const fill = after.need ? after.into / after.need : 1;
  const from = levelled ? 0 : before.need ? before.into / before.need : 1;
  return (
    <section className="earned" aria-label="Rewards earned">
      <div className="earned-head">
        <span className="earned-xp">+{outcome.xpGained} XP</span>
        <span className="earned-level">
          Level {after.level}
          {after.need > 0 && (
            <span className="dim">
              {' '}
              · {after.into}/{after.need}
            </span>
          )}
        </span>
      </div>
      <div className="xp-bar" aria-hidden="true">
        <span style={{ '--from': from, '--to': fill } as CSSProperties} />
      </div>
      {outcome.xpLines.length > 0 && (
        <details className="xp-lines">
          <summary>Where the XP came from</summary>
          <ul>
            {outcome.xpLines.map((l, i) => (
              <li key={i}>
                <span>{l.label}</span>
                <span>+{l.xp}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {items.length > 0 && (
        <ul className="rewards">
          {items.map((it, i) => (
            <li key={it.key} style={{ animationDelay: `${0.6 + i * 0.12}s` }}>
              <span className="reward-kind">{it.kind}</span>
              <span className="reward-name">{it.name}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** How close this run came to the objective, as a fraction and a sentence. */
function objectiveProgress(result: Result): { pct: number; text: ReactNode } | null {
  const { summary, stats } = result;
  const def = summary.mode === 'stage' ? STAGES[summary.stage] : summary.mode === 'trial' ? TRIALS[summary.stage] : null;
  if (!def) return null;
  const o = def.objective;
  if (o.type === 'survive' && o.seconds) {
    const pct = Math.min(1, summary.time / o.seconds);
    return {
      pct,
      text: (
        <>
          <strong>{Math.round(pct * 100)}%</strong> there. Just <strong>{Math.max(0, o.seconds - summary.time).toFixed(1)}s</strong> to go
        </>
      ),
    };
  }
  if (o.type === 'orbs' && o.orbs) {
    return {
      pct: Math.min(1, stats.orbs / o.orbs),
      text: (
        <>
          <strong>
            {stats.orbs}/{o.orbs}
          </strong>{' '}
          orbs collected{o.timeLimit ? ` in ${summary.time.toFixed(1)}s` : ''}
        </>
      ),
    };
  }
  if (o.type === 'boss' && result.boss) {
    const dealt = result.boss.maxHp - result.boss.hp;
    return {
      pct: dealt / result.boss.maxHp,
      text: (
        <>
          Core damaged <strong>
            {dealt}/{result.boss.maxHp}
          </strong>
          . It is weakening
        </>
      ),
    };
  }
  return null;
}

export function GameOverScreen(props: {
  result: Result;
  progress: Progress;
  isTouch: boolean;
  canSkip: boolean;
  onRetry: () => void;
  onMenu: () => void;
  onLevels: () => void;
  onModes: () => void;
  onSkip: () => void;
}) {
  if (isEndlessMode(props.result.summary.mode)) return <EndlessOverScreen {...props} />;
  const { summary, outcome, stats, previousTime } = props.result;
  const p = props.progress;
  const level = summary.mode === 'stage' ? STAGES[summary.stage] : null;
  const hint = nextUnlockHint(p);
  const delta = previousTime === null ? null : summary.time - previousTime;
  const progressInfo = objectiveProgress(props.result);
  const accent = level?.accent ?? (summary.mode === 'trial' ? TRIALS[summary.stage].accent : null);

  let hook: ReactNode = null;
  if (progressInfo) {
    hook = (
      <div className="hook">
        <div className="hook-bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${progressInfo.pct})` }} />
        </div>
        <p className="hook-text">{progressInfo.text}</p>
      </div>
    );
  } else if (outcome.isNewBest) {
    hook = <p className="badge">New personal best</p>;
  } else {
    hook = (
      <p className="hook-text">
        <strong>{(outcome.best - summary.score).toLocaleString()}</strong> points from your best
      </p>
    );
  }

  let trend: ReactNode = null;
  if (delta !== null && delta > 0.05) trend = <p className="trend trend-up">+{delta.toFixed(1)}s longer than your last run</p>;
  else if (delta !== null) trend = <p className="trend">Last run {previousTime!.toFixed(1)}s. You can beat it</p>;

  const fails = level ? p.fails[summary.stage] ?? 0 : 0;

  return (
    <Overlay>
      <div className="result" style={accent ? ({ '--lvl': rgb(accent) } as CSSProperties) : undefined}>
        <p className="kicker">{level ? `Level ${summary.stage + 1} · ${level.name}` : props.result.label}</p>
        {props.result.cause && <p className="lede lede-tight cause">{CAUSE_TEXT[props.result.cause]}</p>}
        <div className="tiles">
          <Tile label="Score" value={summary.score.toLocaleString()} accent />
          <Tile label="Time" value={`${summary.time.toFixed(1)}s`} />
          <Tile label="Best" value={outcome.best ? outcome.best.toLocaleString() : '—'} />
        </div>
        {hook}
        {props.result.phase && props.result.phase.count > 1 && (
          <p className="phase-reached">
            Reached phase <strong>{props.result.phase.index + 1}</strong> of {props.result.phase.count} · {props.result.phase.name}
          </p>
        )}
        {trend}

        <button type="button" className="btn btn-primary btn-retry" onClick={props.onRetry} autoFocus>
          <span>Retry</span>
          <span className="btn-sub">{props.isTouch ? 'One tap. Straight back in' : 'Enter or R'}</span>
        </button>

        {props.canSkip && (
          <div className="skip-offer">
            <p className="skip-text">
              Stuck on {level?.name}? You have tried {fails} times. You can skip ahead for free; a skipped level gives no stars, and you
              can come back to clear it any time.
            </p>
            <button type="button" className="btn btn-small" onClick={props.onSkip}>
              Skip level (no stars)
            </button>
          </div>
        )}

        <Rewards outcome={outcome} />
        <dl className="stats stats-compact">
          <StatRow label="Near misses" value={String(stats.nearMisses)} />
          <StatRow label="Peak multiplier" value={`×${stats.peakMultiplier.toFixed(1)}`} />
          {stats.orbs > 0 && <StatRow label="Orbs" value={String(stats.orbs)} />}
          <StatRow label="Chaos survived" value={String(stats.eventsSurvived)} />
        </dl>
        {outcome.newUnlocks.length === 0 && hint && <p className="next-hint">Next: {hint}</p>}
        {level && !props.canSkip && fails > 0 && fails < SKIP_AFTER_FAILS && (
          <p className="lifetime">Attempt {fails + 1} coming up. You are getting closer</p>
        )}
        <p className="lifetime">
          Lifetime: {formatDuration(p.totalTime)} survived over {p.runs} {p.runs === 1 ? 'run' : 'runs'}
        </p>
        <div className="actions actions-quiet">
          {level && (
            <button type="button" className="btn btn-small" onClick={props.onLevels}>
              Levels
            </button>
          )}
          <button type="button" className="btn btn-small" onClick={props.onMenu}>
            Menu
          </button>
        </div>
        <AdSlot placement="results_banner" className="ad-results" />
      </div>
    </Overlay>
  );
}

function EndlessOverScreen(props: { result: Result; progress: Progress; isTouch: boolean; onRetry: () => void; onMenu: () => void; onModes: () => void }) {
  const { summary, outcome, stats, previousTime } = props.result;
  const id = summary.mode as Exclude<RunSummary['mode'], 'stage' | 'daily' | 'trial'>;
  const mode = endlessMode(id);
  const best = props.progress.modeBests[id];
  const delta = previousTime === null ? null : summary.time - previousTime;
  return (
    <Overlay>
      <div className="result" style={{ '--lvl': rgb(mode.accent) } as CSSProperties}>
        <p className="kicker">{mode.name} · run over</p>
        {props.result.cause && <p className="lede lede-tight cause">{CAUSE_TEXT[props.result.cause]}</p>}
        <div className="tiles">
          {endlessTiles(summary, best).map(([label, value, accent]) => (
            <Tile key={label} label={label} value={value} accent={accent} />
          ))}
        </div>
        {outcome.newBests.length > 0 ? (
          <p className="badge">New best {outcome.newBests.map((k) => BEST_LABEL[k]).join(' · ')}</p>
        ) : (
          <p className="hook-text">
            Best score <strong>{best.score.toLocaleString()}</strong> · longest run <strong>{best.time.toFixed(1)}s</strong>
          </p>
        )}
        {props.result.phase && props.result.phase.count > 1 && (
          <p className="phase-reached">
            Reached stage <strong>{props.result.phase.index + 1}</strong> of {props.result.phase.count} · {props.result.phase.name}
          </p>
        )}
        {delta !== null && delta > 0.05 && <p className="trend trend-up">+{delta.toFixed(1)}s longer than your last run</p>}

        <button type="button" className="btn btn-primary btn-retry" onClick={props.onRetry} autoFocus>
          <span>Restart</span>
          <span className="btn-sub">{props.isTouch ? 'One tap. Fresh run' : 'Enter or R'}</span>
        </button>

        <Rewards outcome={outcome} />
        <dl className="stats stats-compact">
          <StatRow label="Survived" value={`${summary.time.toFixed(1)}s`} />
          {id !== 'orbrush' && stats.orbs > 0 && <StatRow label="Orbs" value={String(stats.orbs)} />}
          {stats.bonusOrbs > 0 && <StatRow label="Gold orbs" value={String(stats.bonusOrbs)} />}
          {id !== 'chaos' && <StatRow label="Chaos survived" value={String(stats.eventsSurvived)} />}
          <StatRow label="Near misses" value={String(stats.nearMisses)} />
          <StatRow label="Peak multiplier" value={`×${stats.peakMultiplier.toFixed(1)}`} />
          <StatRow label="Hazards dodged" value={String(stats.hazardsDodged)} />
        </dl>
        <div className="actions actions-quiet">
          <button type="button" className="btn btn-small" onClick={props.onModes}>
            Modes
          </button>
          <button type="button" className="btn btn-small" onClick={props.onMenu}>
            Menu
          </button>
        </div>
        <AdSlot placement="endless_results_banner" className="ad-results" />
      </div>
    </Overlay>
  );
}

export function VictoryScreen(props: { result: Result; isTouch: boolean; onNext: () => void; onRetry: () => void; onLevels: () => void }) {
  const { summary, outcome, stats } = props.result;
  const trial = summary.mode === 'trial';
  const index = summary.stage;
  const def = trial ? TRIALS[index] : STAGES[index];
  const final = !trial && index === STAGES.length - 1;
  const stars = !trial;
  const [two, three] = stars ? starThresholds(index) : [0, 0];
  const nextTarget = !stars ? null : outcome.stars < 2 ? two : outcome.stars < 3 ? three : null;
  const nextLevel = !trial && !final ? STAGES[index + 1] : null;

  return (
    <Overlay>
      <div className="result victory" style={{ '--lvl': rgb(def.accent) } as CSSProperties}>
        <p className="stamp">{final ? 'Core destroyed' : trial ? 'Trial complete' : 'Level complete'}</p>
        <h2 className="victory-name">{final ? 'Chaos conquered' : def.name}</h2>
        {stars && <Stars count={outcome.stars} animate />}
        <p className="score-big score-win">{summary.score.toLocaleString()}</p>
        {outcome.isNewBest && outcome.previousBest > 0 && <p className="badge">New best</p>}
        {nextTarget !== null && (
          <p className="hook-text">
            Score <strong>{nextTarget.toLocaleString()}</strong> for {outcome.stars < 2 ? '★★' : '★★★'}. Near misses and orbs build your multiplier.
          </p>
        )}
        {nextLevel && outcome.firstClear && (
          <div className="unlocked-next" style={{ '--next': rgb(nextLevel.accent) } as CSSProperties}>
            <span className="unlocked-kicker">Unlocked</span>
            <span className="unlocked-name">
              Level {index + 2} · {nextLevel.name}
            </span>
            <span className="dim">{objectiveText(nextLevel.objective)}</span>
          </div>
        )}
        <Rewards outcome={outcome} />
        <dl className="stats stats-compact">
          <StatRow label="Time" value={`${summary.time.toFixed(1)}s`} />
          <StatRow label="Near misses" value={String(stats.nearMisses)} />
          <StatRow label="Peak multiplier" value={`×${stats.peakMultiplier.toFixed(1)}`} />
          {stats.orbs > 0 && <StatRow label="Orbs" value={String(stats.orbs)} />}
        </dl>
        <div className="actions">
          <button type="button" className="btn btn-primary btn-wide" onClick={props.onNext} autoFocus>
            {trial ? 'Play again' : final ? 'Play Endless' : `Next · Level ${index + 2}`}
          </button>
          {!trial && (
            <button type="button" className="btn" onClick={props.onRetry}>
              Replay
            </button>
          )}
          <button type="button" className="btn" onClick={props.onLevels}>
            {trial ? 'Chaos+' : 'Levels'}
          </button>
        </div>
        {!props.isTouch && <p className="hint">Enter to continue · R to replay</p>}
        <AdSlot placement="results_banner" className="ad-results" />
      </div>
    </Overlay>
  );
}

export function PausedScreen(props: { score: number; time: number; muted: boolean; onResume: () => void; onRestart: () => void; onToggleSound: () => void; onMenu: () => void }) {
  return (
    <Overlay>
      <p className="kicker">Paused</p>
      <h2 className="title title-sm">Take a breath</h2>
      <p className="lede">
        Score {props.score.toLocaleString()} · {props.time.toFixed(1)}s survived
      </p>
      <div className="actions actions-stack">
        <button type="button" className="btn btn-primary" onClick={props.onResume} autoFocus>
          Resume
        </button>
        <button type="button" className="btn" onClick={props.onRestart}>
          Restart
        </button>
        <button type="button" className="btn" onClick={props.onToggleSound}>
          Sound {props.muted ? 'off' : 'on'}
        </button>
        <button type="button" className="btn" onClick={props.onMenu}>
          Quit to menu
        </button>
      </div>
    </Overlay>
  );
}
