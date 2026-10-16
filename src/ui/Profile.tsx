import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { STAGES, objectiveText } from '../game/stages';
import { accountLevel, hasVerifiedChaosPlus, totalStars, maxStars, levelsCleared, type Progress } from '../progress';
import { HISTORY_KEEP, challengeById, currentChallenges, MAX_ACCOUNT_LEVEL, type ChallengeSet } from '../progression';
import { AdSlot } from './AdSlot';
import { BackButton, ShapePreview, Stars } from './common';

const rgb = (c: [number, number, number]) => `rgb(${c.join(',')})`;

const MODE_NAMES: Record<string, string> = {
  stage: 'Campaign',
  endless: 'Classic Survival',
  orbrush: 'Orb Rush',
  chaos: 'Chaos Survival',
  bossrush: 'Boss Rush',
  daily: 'Daily',
  trial: 'Trial',
};

function untilMidnight(now: Date): string {
  const end = new Date(now);
  end.setHours(24, 0, 0, 0);
  const mins = Math.max(1, Math.round((end.getTime() - now.getTime()) / 60000));
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

function untilMonday(now: Date): string {
  const end = new Date(now);
  const day = now.getDay() || 7;
  end.setDate(now.getDate() + (8 - day));
  end.setHours(0, 0, 0, 0);
  const hours = Math.max(1, Math.round((end.getTime() - now.getTime()) / 3600000));
  return hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h`;
}

export function ChallengeList({ set, title, resets }: { set: ChallengeSet; title: string; resets: string }) {
  return (
    <section className="challenges" aria-label={title}>
      <div className="section-head">
        <h3>{title}</h3>
        <span className="dim">New in {resets}</span>
      </div>
      <ul>
        {set.ids.map((id, i) => {
          const def = challengeById(id);
          if (!def) return null;
          const pct = Math.min(1, set.progress[i] / def.target);
          return (
            <li key={id} className={set.done[i] ? 'challenge-done' : ''}>
              <span className="challenge-text">
                {set.done[i] && <span className="sr-only">Completed: </span>}
                {def.text}
              </span>
              <span className="challenge-xp">{set.done[i] ? '✓ Done' : `+${def.xp} XP`}</span>
              <span className="challenge-bar" aria-hidden="true">
                <span style={{ transform: `scaleX(${pct})` }} />
              </span>
              <span className="challenge-count">
                {Math.floor(set.progress[i])}/{def.target}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ProfileScreen(props: { progress: Progress; account: ReactNode; onBack: () => void }) {
  const p = props.progress;
  const [tab, setTab] = useState<'overview' | 'campaign' | 'history'>('overview');
  const lvl = accountLevel(p);
  const now = useMemo(() => new Date(), []);
  const ch = currentChallenges(p.challenges, now);
  const fmt = (t: number) => `${t.toFixed(1)}s`;

  return (
    <div className="screen profile">
      <header className="screen-top">
        <BackButton onClick={props.onBack} />
        <h2 className="screen-heading">Profile</h2>
        <span />
      </header>
      <div className="screen-scroll">
        <section className="profile-card">
          <span className="profile-avatar" aria-hidden="true">
            <ShapePreview shape={p.settings.shape} size={44} />
          </span>
          <div className="profile-main">
            <p className="profile-level">
              Level <strong>{lvl.level}</strong>
              {lvl.level >= MAX_ACCOUNT_LEVEL && <span className="dim"> · max</span>}
              {hasVerifiedChaosPlus() && <span className="plus-chip profile-badge">Chaos+ supporter</span>}
            </p>
            <div className="xp-bar" role="progressbar" aria-label="XP to next level" aria-valuemin={0} aria-valuemax={lvl.need || 1} aria-valuenow={lvl.into}>
              <span style={{ '--from': 0, '--to': lvl.need ? lvl.into / lvl.need : 1 } as CSSProperties} />
            </div>
            <p className="dim small">{lvl.need ? `${lvl.into} / ${lvl.need} XP to level ${lvl.level + 1}` : `${p.xp.toLocaleString()} XP`}</p>
          </div>
        </section>

        {props.account}

        <div className="tabs" role="tablist">
          {(['overview', 'campaign', 'history'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={`tab${tab === t ? ' tab-on' : ''}`} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <>
            <ChallengeList set={ch.daily!} title="Daily challenges" resets={untilMidnight(now)} />
            <ChallengeList set={ch.weekly!} title="Weekly challenges" resets={untilMonday(now)} />
            <section className="stat-grid">
              {(
                [
                  ['Levels cleared', `${levelsCleared(p)}/${STAGES.length}`],
                  ['Stars', `${totalStars(p)}/${maxStars()}`],
                  ['Runs', String(p.runs)],
                  ['Total XP', p.xp.toLocaleString()],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k} className="stat-card">
                  <span className="stat-card-value">{v}</span>
                  <span className="stat-card-label">{k}</span>
                </div>
              ))}
            </section>
          </>
        )}

        {tab === 'campaign' && (
          <div className="table-wrap">
            <table className="level-table">
              <caption className="sr-only">Personal records for each campaign level</caption>
              <thead>
                <tr>
                  <th scope="col">Level</th>
                  <th scope="col">Stars</th>
                  <th scope="col">Best score</th>
                  <th scope="col">Fastest clear</th>
                  <th scope="col">Attempts</th>
                  <th scope="col">Deaths</th>
                </tr>
              </thead>
              <tbody>
                {STAGES.map((st, i) => {
                  const rec = p.stages[i];
                  const stats = p.stageStats[i];
                  return (
                    <tr key={st.name} style={{ '--lvl': rgb(st.accent) } as CSSProperties}>
                      <th scope="row">
                        <span className="lt-num">{i + 1}</span> {st.name}
                        <span className="lt-arena">
                          {st.arena.name} · {objectiveText(st.objective)}
                        </span>
                      </th>
                      <td>{rec ? <Stars count={rec.stars} /> : <span className="dim">—</span>}</td>
                      <td>{rec ? rec.best.toLocaleString() : '—'}</td>
                      <td>{stats?.fastest != null && st.objective.type !== 'survive' ? fmt(stats.fastest) : stats?.fastest != null ? 'Cleared' : '—'}</td>
                      <td>{stats?.attempts ?? 0}</td>
                      <td>{stats?.deaths ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'history' &&
          (p.history.length === 0 ? (
            <p className="board-empty">No matches yet. Your last {HISTORY_KEEP} runs will appear here.</p>
          ) : (
            <ol className="history">
              {p.history.map((h, i) => (
                <li key={`${h.date}-${i}`} className={h.won ? 'history-won' : ''}>
                  <span className="history-mode">
                    {MODE_NAMES[h.mode] ?? h.mode}
                    <span className="dim"> · {h.label}</span>
                  </span>
                  <span className="history-result">{h.won ? 'Won' : h.mode === 'stage' || h.mode === 'trial' ? 'Lost' : 'Run over'}</span>
                  <span className="history-num">{h.score.toLocaleString()}</span>
                  <span className="history-num dim">{fmt(h.time)}</span>
                  <span className="history-xp">+{h.xp} XP</span>
                </li>
              ))}
            </ol>
          ))}

        <AdSlot placement="profile_banner" />
      </div>
    </div>
  );
}
