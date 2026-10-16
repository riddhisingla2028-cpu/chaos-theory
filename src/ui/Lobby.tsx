import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';

import type { Look } from '../game/render';
import { ENDLESS_MODES, STAGES, TRIALS, objectiveText, stageConfig, starThresholds, type EndlessId, type Mutator } from '../game/stages';
import {
  ACHIEVEMENTS,
  SHAPES,
  THEMES,
  isCleared,
  isSkipped,
  isStageUnlocked,
  levelsCleared,
  maxStars,
  nextStage,
  totalStars,
  accountLevel,
  type Progress,
  type RecordEntry,
} from '../progress';
import { challengeById, currentChallenges } from '../progression';
import { LevelPreview } from './LevelPreview';
import { AdSlot } from './AdSlot';
import { PURCHASES_AVAILABLE, type PremiumStatus } from '../monetization/entitlements';
import type { AudioState } from '../game/audio';
import { BackButton, LockIcon, ShapePreview, SoundToggle, Stars } from './common';

const rgb = (c: [number, number, number]) => `rgb(${c.join(',')})`;
const DIFFICULTY = ['', 'Easy', 'Easy', 'Medium', 'Hard', 'Brutal'];

function formatDuration(seconds: number): string {
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function Pips({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <span className="pips" aria-label={`Difficulty ${value} of ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < value ? 'pip pip-on' : 'pip'} />
      ))}
    </span>
  );
}

// ---------- Splash ----------

export function SplashScreen({ isTouch, onEnter }: { isTouch: boolean; onEnter: () => void }) {
  return (
    // click (not pointerdown): iOS only lets audio start on touchend/click, so this tap unlocks sound.
    <div className="screen splash" onClick={onEnter} role="button" tabIndex={0} aria-label="Start">
      <div className="splash-inner">
        <p className="eyebrow">A survival game where the rules break</p>
        <h1 className="logo logo-xl" data-text="CHAOS THEORY">
          <span>CHAOS</span>
          <span>THEORY</span>
        </h1>
        <p className="press">{isTouch ? 'Tap to start' : 'Press any key'}</p>
        <p className="splash-foot">Best with sound on</p>
      </div>
    </div>
  );
}

// ---------- Home ----------

export function HomeScreen(props: {
  progress: Progress;
  daily: { mutator: Mutator; best: number };
  muted: boolean;
  audioState: AudioState;
  isTouch: boolean;
  onToggleSound: () => void;
  onEnableSound: () => void;
  onPlay: () => void;
  onLevels: () => void;
  onModes: () => void;
  onDaily: () => void;
  onTrials: () => void;
  onCollection: () => void;
  onRecords: () => void;
  onSettings: () => void;
  onPremium: () => void;
  onProfile: () => void;
  onTutorial: () => void;
  extraTiles?: ReactNode;
}) {
  const p = props.progress;
  const next = nextStage(p);
  const cleared = levelsCleared(p);
  const nextDef = next >= 0 ? STAGES[next] : null;
  const playSub = nextDef ? `Level ${next + 1} · ${nextDef.name} · ${nextDef.arena.name}` : 'Campaign complete · play Endless';
  const lvl = accountLevel(p);
  const today = currentChallenges(p.challenges, new Date()).daily!;
  const todayDone = today.done.filter(Boolean).length;
  return (
    <div className="screen home">
      <header className="topbar">
        <span className="logo logo-sm">CHAOS THEORY</span>
        <div className="topbar-right">
          <button type="button" className="profile-chip" onClick={props.onProfile} aria-label={`Profile: account level ${lvl.level}`}>
            <ShapePreview shape={p.settings.shape} size={18} />
            <span className="profile-chip-level">Lv {lvl.level}</span>
            <span className="profile-chip-bar" aria-hidden="true">
              <span style={{ transform: `scaleX(${lvl.need ? lvl.into / lvl.need : 1})` }} />
            </span>
          </button>
          <span className="player-chip" title="Stars earned">
            ★ {totalStars(p)}
            <span className="dim">/{maxStars()}</span>
          </span>
          {p.premiumDemo && <span className="plus-chip">Cosmetics preview</span>}
          <SoundToggle muted={props.muted} audioState={props.audioState} onToggle={props.onToggleSound} onEnable={props.onEnableSound} />
        </div>
      </header>

      <main className="home-main">
        <section className="hero">
          <p className="eyebrow">Ten arenas. Nine rules. One Core.</p>
          <h1 className="logo logo-xl" data-text="CHAOS THEORY">
            <span>CHAOS</span>
            <span>THEORY</span>
          </h1>
          <p className="hero-tag">Survive the arena. The rules won&rsquo;t stay the same.</p>
          <button type="button" className="play-now" onClick={props.onPlay} autoFocus style={nextDef ? ({ '--lvl': rgb(nextDef.accent) } as CSSProperties) : undefined}>
            <span className="play-now-label">{nextDef ? 'Play campaign' : 'Play Endless'}</span>
            <span className="play-now-sub">{playSub}</span>
          </button>
          <div className="campaign" aria-label={`${cleared} of ${STAGES.length} levels cleared`}>
            <div className="campaign-bar">
              <span style={{ transform: `scaleX(${cleared / STAGES.length})` }} />
            </div>
            <span className="campaign-text">
              Campaign {cleared}/{STAGES.length}
            </span>
          </div>
        </section>

        <section className="mode-tiles" aria-label="Game modes">
          <ModeTile title="Levels" meta={`${cleared}/${STAGES.length} cleared`} glyph="map" onClick={props.onLevels} />
          <ModeTile title="Endless Modes" meta="4 modes · always unlocked" glyph="infinity" onClick={props.onModes} featured />
          <ModeTile title="Daily" meta={`${props.daily.mutator.name}${props.daily.best ? ` · ${props.daily.best.toLocaleString()}` : ''}`} glyph="sun" onClick={props.onDaily} />
          <ModeTile title="Trials" meta={p.premiumDemo ? `${TRIALS.length} bonus challenges` : 'Chaos+'} glyph="bolt" onClick={props.onTrials} badge={!p.premiumDemo ? 'Plus' : undefined} />
          {props.extraTiles}
        </section>

        <button type="button" className="today" onClick={props.onProfile}>
          <span className="today-head">
            <span className="today-title">Today&rsquo;s challenges</span>
            <span className="today-count">
              {todayDone}/{today.ids.length} done
            </span>
          </span>
          <span className="today-list">
            {today.ids.map((id, i) => {
              const def = challengeById(id);
              if (!def) return null;
              return (
                <span key={id} className={`today-item${today.done[i] ? ' today-done' : ''}`}>
                  <span className="today-text">{def.text}</span>
                  <span className="today-bar" aria-hidden="true">
                    <span style={{ transform: `scaleX(${Math.min(1, today.progress[i] / def.target)})` }} />
                  </span>
                </span>
              );
            })}
          </span>
        </button>
        <AdSlot placement="home_banner" />
      </main>

      <nav className="bottom-nav" aria-label="More">
        <button type="button" onClick={props.onProfile}>
          Profile
        </button>
        <button type="button" onClick={props.onCollection}>
          Collection<span className="dim"> {p.achievements.length}/{ACHIEVEMENTS.length}</span>
        </button>
        <button type="button" onClick={props.onRecords}>Records</button>
        <button type="button" onClick={props.onPremium} className="nav-plus">
          Chaos+ Ad-Free
        </button>
        <button type="button" onClick={props.onSettings}>Settings</button>
        <button type="button" onClick={props.onTutorial}>How to play</button>
      </nav>
    </div>
  );
}

function Glyph({ name }: { name: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 } as const;
  return (
    <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
      {name === 'map' && <path {...common} d="M5 25l6-15 7 9 4-5 5 11M5 25h22" />}
      {name === 'infinity' && <path {...common} d="M9 11c-6 0-6 10 0 10s8-10 14-10 6 10 0 10-8-10-14-10z" />}
      {name === 'sun' && (
        <g {...common}>
          <circle cx="16" cy="16" r="5" />
          <path d="M16 4v4M16 24v4M4 16h4M24 16h4M7.5 7.5l3 3M21.5 21.5l3 3M7.5 24.5l3-3M21.5 10.5l3-3" />
        </g>
      )}
      {name === 'bolt' && <path {...common} d="M18 3L8 18h7l-2 11 10-15h-7z" />}
      {name === 'orb' && <path {...common} d="M16 4l7 12-7 12-7-12z" />}
      {name === 'chaos' && <path {...common} d="M6 10h12l-4-4M26 22H14l4 4M6 22c6 0 8-12 20-12" />}
      {name === 'core' && (
        <g {...common}>
          <circle cx="16" cy="16" r="5" />
          <circle cx="16" cy="16" r="11" strokeDasharray="4 3" />
        </g>
      )}
    </svg>
  );
}

function ModeTile({ title, meta, glyph, onClick, badge, featured }: { title: string; meta: string; glyph: string; onClick: () => void; badge?: string; featured?: boolean }) {
  return (
    <button type="button" className={`mode-tile${featured ? ' mode-tile-featured' : ''}`} onClick={onClick}>
      <span className="mode-glyph">
        <Glyph name={glyph} />
      </span>
      <span className="mode-title">{title}</span>
      <span className="mode-meta">{meta}</span>
      {badge && <span className="mode-badge">{badge}</span>}
    </button>
  );
}

// ---------- Level map ----------

export function LevelMap(props: { progress: Progress; themeLook: Pick<Look, 'arena' | 'accent' | 'shape'>; initial: number; onPlay: (i: number) => void; onBack: () => void }) {
  const p = props.progress;
  const [selected, setSelected] = useState(props.initial);
  const st = STAGES[selected];
  const unlocked = isStageUnlocked(p, selected);
  const rec = p.stages[selected];
  const config = useMemo(() => stageConfig(selected), [selected]);
  const look: Look = { ...props.themeLook, glow: st.accent, motif: st.motif, heat: st.heat, shake: false };
  const [two, three] = starThresholds(selected);
  const needed = selected; // levels before this one
  const done = Array.from({ length: selected }, (_, i) => isCleared(p, i) || isSkipped(p, i)).filter(Boolean).length;
  const current = nextStage(p);

  return (
    <div className="screen levels">
      <header className="screen-top">
        <BackButton onClick={props.onBack} />
        <h2 className="screen-heading">Levels</h2>
        <span className="player-chip">
          ★ {totalStars(p)}
          <span className="dim">/{maxStars()}</span>
        </span>
      </header>
      <div className="levels-body">
        <div className="levels-left">
        <ol className="level-path">
          {STAGES.map((s, i) => {
            const open = isStageUnlocked(p, i);
            const cls = ['level-node', open ? '' : 'locked', isCleared(p, i) ? 'cleared' : '', isSkipped(p, i) ? 'skipped' : '', i === current ? 'current' : '', i === selected ? 'selected' : '']
              .filter(Boolean)
              .join(' ');
            return (
              <li key={s.name} style={{ '--lvl': rgb(s.accent) } as CSSProperties}>
                <button type="button" className={cls} onClick={() => setSelected(i)} aria-pressed={i === selected} aria-label={`Level ${i + 1}, ${s.name}${open ? '' : ', locked'}`}>
                  <span className="node-num">{open ? String(i + 1).padStart(2, '0') : <LockIcon />}</span>
                  <span className="node-name">{s.name}</span>
                  <span className="node-foot">{isCleared(p, i) ? <Stars count={p.stages[i].stars} /> : isSkipped(p, i) ? <span className="dim">Skipped</span> : <Pips value={s.difficulty} />}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <AdSlot placement="level_select_banner" />
        </div>

        <aside className="level-detail" style={{ '--lvl': rgb(st.accent) } as CSSProperties} aria-live="polite">
          <p className="eyebrow eyebrow-lvl">
            Level {String(selected + 1).padStart(2, '0')} · {DIFFICULTY[st.difficulty]}
          </p>
          <h3 className="detail-name">{st.name}</h3>
          <p className="detail-tag">{st.tagline}</p>
          <div className={`preview${unlocked ? '' : ' preview-locked'}`}>
            <LevelPreview key={selected} config={config} look={look} clip={unlocked ? 9 : 4} label={`Preview of ${st.name}`} />
            {!unlocked && (
              <div className="preview-veil">
                <LockIcon />
                <span className="veil-title">Locked</span>
                <span className="veil-teaser">{st.teaser}</span>
              </div>
            )}
          </div>
          <div className="detail-facts">
            <span className="fact">
              <span className="fact-label">Objective</span>
              <span className="fact-value">{objectiveText(st.objective)}</span>
            </span>
            <span className="fact">
              <span className="fact-label">Difficulty</span>
              <Pips value={st.difficulty} />
            </span>
          </div>
          <ol className="phase-list" aria-label="Phases">
            {st.phases.map((ph, k) => (
              <li key={ph.name}>
                <span className="phase-num">{k + 1}</span>
                {unlocked || k === 0 ? ph.name : '???'}
              </li>
            ))}
          </ol>
          <div className="chips">
            {st.mechanics.map((m) => (
              <span key={m} className="chip chip-lvl">
                {m}
              </span>
            ))}
          </div>
          {unlocked ? (
            <>
              <div className="detail-record">
                <Stars count={rec?.stars ?? 0} />
                <span className="dim">
                  {rec ? `Best ${rec.best.toLocaleString()}` : isSkipped(p, selected) ? 'Skipped. Clear it to earn stars' : 'Not cleared yet'} · ★★ {two} · ★★★ {three}
                </span>
              </div>
              <button type="button" className="btn btn-primary btn-play" onClick={() => props.onPlay(selected)}>
                Play level {selected + 1}
              </button>
            </>
          ) : (
            <div className="unlock">
              <span className="unlock-title">Unlock by playing</span>
              <div className="unlock-bar">
                <span style={{ transform: `scaleX(${done / needed})` }} />
              </div>
              <span className="dim">
                Clear Level {selected} to unlock · {needed - done} {needed - done === 1 ? 'level' : 'levels'} to go
              </span>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// ---------- Endless modes ----------

const MODE_GLYPH: Record<EndlessId, string> = { endless: 'infinity', orbrush: 'orb', chaos: 'chaos', bossrush: 'core' };

/** The personal-best numbers that matter for each mode. */
export function modeBestRows(id: EndlessId, b: Progress['modeBests'][EndlessId]): [string, string][] {
  const time = `${b.time.toFixed(1)}s`;
  if (id === 'orbrush') return [['Best orbs', String(b.orbs)], ['Best score', b.score.toLocaleString()], ['Longest run', time]];
  if (id === 'chaos') return [['Best score', b.score.toLocaleString()], ['Most events', String(b.events)], ['Longest run', time]];
  if (id === 'bossrush') return [['Best streak', `${b.bosses} ${b.bosses === 1 ? 'boss' : 'bosses'}`], ['Best score', b.score.toLocaleString()], ['Longest run', time]];
  return [['Best time', time], ['Best score', b.score.toLocaleString()], ['Most events', String(b.events)]];
}

export function ModesScreen(props: { progress: Progress; themeLook: Pick<Look, 'arena' | 'accent' | 'shape'>; initial: EndlessId; onStart: (id: EndlessId) => void; onBack: () => void }) {
  const [selected, setSelected] = useState<EndlessId>(props.initial);
  const mode = ENDLESS_MODES.find((m) => m.id === selected)!;
  const best = props.progress.modeBests[selected];
  const look: Look = { ...props.themeLook, glow: mode.accent, motif: mode.motif, heat: 0.3, shake: false };
  return (
    <div className="screen modes">
      <header className="screen-top">
        <BackButton onClick={props.onBack} />
        <h2 className="screen-heading">Endless Modes</h2>
        <span className="player-chip">Always unlocked</span>
      </header>
      <div className="levels-body">
        <ul className="mode-list">
          {ENDLESS_MODES.map((m) => {
            const b = props.progress.modeBests[m.id];
            const [label, value] = modeBestRows(m.id, b)[0];
            return (
              <li key={m.id} style={{ '--lvl': rgb(m.accent) } as CSSProperties}>
                <button type="button" className={`mode-card${m.id === selected ? ' selected' : ''}`} onClick={() => setSelected(m.id)} aria-pressed={m.id === selected}>
                  <span className="mode-card-glyph">
                    <Glyph name={MODE_GLYPH[m.id]} />
                  </span>
                  <span className="mode-card-text">
                    <span className="mode-card-name">{m.name}</span>
                    <span className="mode-card-tag">{m.tagline}</span>
                  </span>
                  <span className="mode-card-best">
                    <span className="dim">{label}</span>
                    {value}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <aside className="level-detail" style={{ '--lvl': rgb(mode.accent) } as CSSProperties} aria-live="polite">
          <p className="eyebrow eyebrow-lvl">Endless mode</p>
          <h3 className="detail-name">{mode.name}</h3>
          <p className="detail-tag">{mode.objective}</p>
          <div className="preview">
            <LevelPreview key={selected} config={mode.config} look={look} clip={12} label={`Preview of ${mode.name}`} />
          </div>
          <ul className="rule-list">
            {mode.rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
          <div className="best-grid">
            {modeBestRows(selected, best).map(([k, v]) => (
              <span key={k} className="fact">
                <span className="fact-label">{k}</span>
                <span className="fact-value">{v}</span>
              </span>
            ))}
          </div>
          <button type="button" className="btn btn-primary btn-play" onClick={() => props.onStart(selected)}>
            Start {mode.name}
          </button>
        </aside>
      </div>
    </div>
  );
}

// ---------- Records ----------

const MODE_TABS: { mode: RecordEntry['mode']; label: string }[] = [
  { mode: 'endless', label: 'Classic' },
  { mode: 'orbrush', label: 'Orb Rush' },
  { mode: 'chaos', label: 'Chaos' },
  { mode: 'bossrush', label: 'Boss Rush' },
  { mode: 'daily', label: 'Daily' },
  { mode: 'stage', label: 'Levels' },
  { mode: 'trial', label: 'Trials' },
];

export function RecordsScreen({ progress: p, onBack }: { progress: Progress; onBack: () => void }) {
  const [tab, setTab] = useState<RecordEntry['mode']>('endless');
  const rows = p.records.filter((r) => r.mode === tab).sort((a, b) => b.score - a.score);
  const stats: [string, string][] = [
    ['Runs', String(p.runs)],
    ['Time survived', formatDuration(p.totalTime)],
    ['Levels cleared', `${levelsCleared(p)}/${STAGES.length}`],
    ['Stars', `${totalStars(p)}/${maxStars()}`],
    ['Orbs collected', String(p.orbsTotal)],
    ['Achievements', `${p.achievements.length}/${ACHIEVEMENTS.length}`],
    ['Endless best', p.endlessBest.toLocaleString()],
    ['Rules survived', `${p.chaosSurvived.length}/9`],
  ];
  return (
    <div className="screen records">
      <header className="screen-top">
        <BackButton onClick={onBack} />
        <h2 className="screen-heading">Records</h2>
        <span />
      </header>
      <div className="screen-scroll">
        <section className="stat-grid">
          {stats.map(([k, v]) => (
            <div key={k} className="stat-card">
              <span className="stat-card-value">{v}</span>
              <span className="stat-card-label">{k}</span>
            </div>
          ))}
        </section>
        <section className="board">
          <div className="tabs tabs-wrap" role="tablist">
            {MODE_TABS.map((t) => (
              <button key={t.mode} type="button" role="tab" aria-selected={tab === t.mode} className={`tab${tab === t.mode ? ' tab-on' : ''}`} onClick={() => setTab(t.mode)}>
                {t.label}
              </button>
            ))}
          </div>
          {rows.length === 0 ? (
            <p className="board-empty">No runs yet. Your top 10 will appear here.</p>
          ) : (
            <ol className="board-list">
              {rows.map((r, i) => (
                <li key={`${r.date}-${i}`} className={i === 0 ? 'board-top' : ''}>
                  <span className="board-rank">{i + 1}</span>
                  <span className="board-label">{r.label}</span>
                  <span className="board-time">{r.time.toFixed(1)}s</span>
                  <span className="board-score">{r.score.toLocaleString()}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="board-note">Hall of fame · saved on this device</p>
        </section>
      </div>
    </div>
  );
}

// ---------- Chaos+ (demo premium tier) ----------

const PREMIUM_STATUS_TEXT: Record<PremiumStatus, string> = {
  loading: 'Checking purchase status…',
  free: 'Free version · no verified purchase on this device',
  premium: 'Chaos+ Ad-Free active (verified purchase)',
  unavailable: 'Purchase status could not be checked right now',
};

export function PremiumScreen(props: {
  progress: Progress;
  premiumStatus: PremiumStatus;
  onPreviewCosmetics: (on: boolean) => void;
  onPlayTrial: (i: number) => void;
  onBack: () => void;
}) {
  const p = props.progress;
  const premiumShapes = SHAPES.filter((s) => s.premium);
  const premiumThemes = THEMES.filter((t) => t.premium);
  return (
    <div className="screen premium">
      <header className="screen-top">
        <BackButton onClick={props.onBack} />
        <h2 className="screen-heading">Chaos+</h2>
        <span className="demo-pill">Coming soon</span>
      </header>
      <div className="screen-scroll">
        <section className="plus-hero">
          <p className="eyebrow">Optional upgrade · no gameplay advantage</p>
          <h1 className="plus-logo">
            CHAOS<span>+</span>
          </h1>
          <p className="hero-tag">Chaos+ Ad-Free removes advertising and adds exclusive looks. The full game stays free to play and finish.</p>
        </section>

        <section className="perk-grid">
          <Perk title="No ads" text="Advertising is removed from every placement: home, levels and results.">
            <span className="perk-art perk-icon">⊘</span>
          </Perk>
          <Perk title="Everything stays free" text="All 10 levels, the 4 Endless Modes and the daily challenge remain free for everyone.">
            <span className="perk-art perk-icon">∞</span>
          </Perk>
          <Perk title="Fair play" text="No extra lives, no easier levels, no score boosts. Only cosmetics.">
            <span className="perk-art perk-icon">=</span>
          </Perk>
          <Perk title="Exclusive looks" text="Two premium skins, two neon themes and two bonus trials.">
            <span className="perk-art">
              {premiumShapes.map((s) => (
                <ShapePreview key={s.id} shape={s.id} size={30} />
              ))}
              {premiumThemes.map((t) => (
                <span key={t.id} className="swatch-lg" style={{ background: t.arena, boxShadow: `inset 0 0 0 2px ${rgb(t.accent)}, 0 0 12px ${rgb(t.accent)}` }} />
              ))}
            </span>
          </Perk>
        </section>

        <section className="plus-buy">
          <p className="plus-status">{PREMIUM_STATUS_TEXT[props.premiumStatus]}</p>
          <button type="button" className="play-now play-now-plus" disabled={!PURCHASES_AVAILABLE} aria-disabled={!PURCHASES_AVAILABLE}>
            <span className="play-now-label">{PURCHASES_AVAILABLE ? 'Get Chaos+ Ad-Free' : 'Coming soon'}</span>
            <span className="play-now-sub">Purchases open once a payment provider and verification server are set up</span>
          </button>
          <p className="dim small">No payment is possible today, and nothing on this page charges money.</p>
        </section>

        <section className="plus-owned">
          <h3 className="section-title">Cosmetics preview</h3>
          <p className="dim small">
            Try the Chaos+ skins, themes and trials for free while purchases are unavailable. This is a demo preview: it is not a
            purchase and it does not remove ads.
          </p>
          <button type="button" className="btn btn-small" onClick={() => props.onPreviewCosmetics(!p.premiumDemo)}>
            {p.premiumDemo ? 'Turn off cosmetics preview' : 'Preview cosmetics (demo)'}
          </button>
          {p.premiumDemo && (
            <div className="trial-list">
              {TRIALS.map((t, i) => (
                <div key={t.name} className="trial" style={{ '--lvl': rgb(t.accent) } as CSSProperties}>
                  <span className="trial-text">
                    <span className="trial-name">{t.name}</span>
                    <span className="dim">{t.tagline}</span>
                    <span className="dim">Best {(p.trialBest[i] ?? 0).toLocaleString()}</span>
                  </span>
                  <button type="button" className="btn btn-primary btn-small" onClick={() => props.onPlayTrial(i)}>
                    Play
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Perk({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <div className="perk">
      {children}
      <span className="perk-title">{title}</span>
      <span className="perk-text">{text}</span>
    </div>
  );
}

