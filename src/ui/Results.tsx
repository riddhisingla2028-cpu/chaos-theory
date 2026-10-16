import { useState, type CSSProperties, type ReactNode } from 'react';
import type { DeathCause, GameStats } from '../game/engine';
import { STAGES, TRIALS, objectiveText, starThresholds } from '../game/stages';
import { SKIP_AFTER_FAILS, nextUnlockHint, type Progress, type RunOutcome, type RunSummary } from '../progress';
import { DemoCheckout } from './Lobby';
import { Overlay, Stars } from './common';

export interface Result {
  summary: RunSummary;
  outcome: RunOutcome;
  cause: DeathCause | null;
  stats: GameStats;
  label: string;
  previousTime: number | null; // survival time of the previous attempt at the same mode/level
  boss: { hp: number; maxHp: number } | null;
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
};

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="stats-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Rewards({ outcome }: { outcome: RunOutcome }) {
  const items = [
    ...outcome.newAchievements.map((a) => ({ key: `a-${a.id}`, kind: 'Achievement', name: a.name })),
    ...outcome.newUnlocks.map((u) => ({ key: `u-${u.kind}-${u.id}`, kind: u.kind === 'shape' ? 'New skin' : 'New theme', name: u.name })),
  ];
  if (items.length === 0) return null;
  return (
    <ul className="rewards">
      {items.map((it, i) => (
        <li key={it.key} style={{ animationDelay: `${0.6 + i * 0.12}s` }}>
          <span className="reward-kind">{it.kind}</span>
          <span className="reward-name">{it.name}</span>
        </li>
      ))}
    </ul>
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
  onSkip: () => void;
}) {
  const { summary, outcome, stats, previousTime } = props.result;
  const p = props.progress;
  const level = summary.mode === 'stage' ? STAGES[summary.stage] : null;
  const hint = nextUnlockHint(p);
  const delta = previousTime === null ? null : summary.time - previousTime;
  const progressInfo = objectiveProgress(props.result);
  const [checkout, setCheckout] = useState(false);
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
        {trend}

        <button type="button" className="btn btn-primary btn-retry" onClick={props.onRetry} autoFocus>
          <span>Retry</span>
          <span className="btn-sub">{props.isTouch ? 'One tap. Straight back in' : 'Enter or R'}</span>
        </button>

        {props.canSkip && (
          <div className="skip-offer">
            <p className="skip-text">
              Stuck on {level?.name}? You have tried {fails} times. Every level can be beaten for free, but you can skip ahead.
            </p>
            <button type="button" className="btn btn-small" onClick={() => (p.premiumDemo ? props.onSkip() : setCheckout(true))}>
              {p.premiumDemo ? 'Skip level (Chaos+)' : 'Skip level · demo purchase'}
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
      </div>
      {checkout && (
        <DemoCheckout
          item={`Skip level ${summary.stage + 1}`}
          price="₹19"
          onConfirm={() => {
            setCheckout(false);
            props.onSkip();
          }}
          onCancel={() => setCheckout(false)}
        />
      )}
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
