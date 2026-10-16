import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';

import type { Look } from '../game/render';
import { STAGES, TRIALS, objectiveText, stageConfig, starThresholds, type Mutator } from '../game/stages';
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
  type Progress,
  type RecordEntry,
} from '../progress';
import { LevelPreview } from './LevelPreview';
import { BackButton, LockIcon, ShapePreview, SoundIcon, Stars } from './common';

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
    <div className="screen splash" onPointerDown={onEnter} role="button" tabIndex={0} aria-label="Start">
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
  isTouch: boolean;
  onToggleSound: () => void;
  onPlay: () => void;
  onLevels: () => void;
  onEndless: () => void;
  onDaily: () => void;
  onTrials: () => void;
  onCollection: () => void;
  onRecords: () => void;
  onSettings: () => void;
  onPremium: () => void;
  onTutorial: () => void;
}) {
  const p = props.progress;
  const next = nextStage(p);
  const cleared = levelsCleared(p);
  const nextDef = next >= 0 ? STAGES[next] : null;
  const playSub = nextDef ? `Level ${next + 1} · ${nextDef.name}` : 'Endless mode';
  return (
    <div className="screen home">
      <header className="topbar">
        <span className="logo logo-sm">CHAOS THEORY</span>
        <div className="topbar-right">
          <span className="player-chip" title="Stars earned">
            ★ {totalStars(p)}
            <span className="dim">/{maxStars()}</span>
          </span>
          {p.premiumDemo && <span className="plus-chip">Chaos+ demo</span>}
          <button type="button" className="icon-btn" onClick={props.onToggleSound} aria-label={props.muted ? 'Unmute sound' : 'Mute sound'}>
            <SoundIcon muted={props.muted} />
          </button>
        </div>
      </header>

      <main className="home-main">
        <section className="hero">
          <p className="eyebrow">Ten levels. Nine rules. One arena.</p>
          <h1 className="logo logo-xl" data-text="CHAOS THEORY">
            <span>CHAOS</span>
            <span>THEORY</span>
          </h1>
          <p className="hero-tag">Survive the arena. The rules won&rsquo;t stay the same.</p>
          <button type="button" className="play-now" onClick={props.onPlay} autoFocus style={nextDef ? ({ '--lvl': rgb(nextDef.accent) } as CSSProperties) : undefined}>
            <span className="play-now-label">Play now</span>
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
          <ModeTile title="Endless" meta={`Best ${p.endlessBest.toLocaleString()}`} glyph="infinity" onClick={props.onEndless} />
          <ModeTile title="Daily" meta={`${props.daily.mutator.name}${props.daily.best ? ` · ${props.daily.best.toLocaleString()}` : ''}`} glyph="sun" onClick={props.onDaily} />
          <ModeTile title="Trials" meta={p.premiumDemo ? `${TRIALS.length} bonus challenges` : 'Chaos+'} glyph="bolt" onClick={props.onTrials} badge={!p.premiumDemo ? 'Plus' : undefined} />
        </section>
      </main>

      <nav className="bottom-nav" aria-label="More">
        <button type="button" onClick={props.onCollection}>
          Collection<span className="dim"> {p.achievements.length}/{ACHIEVEMENTS.length}</span>
        </button>
        <button type="button" onClick={props.onRecords}>Records</button>
        <button type="button" onClick={props.onPremium} className="nav-plus">
          Chaos+
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
    </svg>
  );
}

function ModeTile({ title, meta, glyph, onClick, badge }: { title: string; meta: string; glyph: string; onClick: () => void; badge?: string }) {
  return (
    <button type="button" className="mode-tile" onClick={onClick}>
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

// ---------- Records ----------

const MODE_TABS: { mode: RecordEntry['mode']; label: string }[] = [
  { mode: 'endless', label: 'Endless' },
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
          <div className="tabs" role="tablist">
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

export function DemoCheckout({ item, price, onConfirm, onCancel }: { item: string; price: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="demo-title">
      <div className="modal-card">
        <p className="demo-flag">Demo mode · no real payment</p>
        <h3 id="demo-title" className="modal-title">{item}</h3>
        <p className="modal-price">
          <s>{price}</s> <strong>₹0 demo</strong>
        </p>
        <p className="modal-text">
          This is a simulated checkout for review. No payment details are collected and nothing is charged. In a real release, this
          button would open a secure payment page, and the purchase would be verified on a server before anything unlocks.
        </p>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={onConfirm} autoFocus>
            Confirm demo
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function PremiumScreen(props: { progress: Progress; onUnlock: () => void; onRemove: () => void; onPlayTrial: (i: number) => void; onBack: () => void }) {
  const p = props.progress;
  const [checkout, setCheckout] = useState(false);
  const premiumShapes = SHAPES.filter((s) => s.premium);
  const premiumThemes = THEMES.filter((t) => t.premium);
  return (
    <div className="screen premium">
      <header className="screen-top">
        <BackButton onClick={props.onBack} />
        <h2 className="screen-heading">Chaos+</h2>
        <span className="demo-pill">Demo</span>
      </header>
      <div className="screen-scroll">
        <section className="plus-hero">
          <p className="eyebrow">Optional upgrade · cosmetic only</p>
          <h1 className="plus-logo">
            CHAOS<span>+</span>
          </h1>
          <p className="hero-tag">Exclusive looks, bonus challenges and level skips. The full game stays free to finish.</p>
        </section>

        <section className="perk-grid">
          <Perk title="Exclusive skins" text="Two premium player shapes.">
            <span className="perk-art">
              {premiumShapes.map((s) => (
                <ShapePreview key={s.id} shape={s.id} size={36} />
              ))}
            </span>
          </Perk>
          <Perk title="Neon arenas" text="Synthwave and Aurora colour themes.">
            <span className="perk-art">
              {premiumThemes.map((t) => (
                <span key={t.id} className="swatch-lg" style={{ background: t.arena, boxShadow: `inset 0 0 0 2px ${rgb(t.accent)}, 0 0 16px ${rgb(t.accent)}` }} />
              ))}
            </span>
          </Perk>
          <Perk title="Bonus trials" text={TRIALS.map((t) => t.name).join(' · ')}>
            <span className="perk-art perk-icon">⚡</span>
          </Perk>
          <Perk title="Unlimited skips" text="Skip any level you are stuck on, no extra charge.">
            <span className="perk-art perk-icon">»</span>
          </Perk>
        </section>

        {p.premiumDemo ? (
          <section className="plus-owned">
            <p className="plus-active">Chaos+ is active (demo)</p>
            <p className="dim">Equip the new shapes and themes in Collection.</p>
            <h3 className="section-title">Trials</h3>
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
            <button type="button" className="link-btn" onClick={props.onRemove}>
              Remove demo unlock
            </button>
          </section>
        ) : (
          <section className="plus-buy">
            <p className="plus-price">
              ₹99 <span className="dim">one-time</span>
            </p>
            <button type="button" className="play-now play-now-plus" onClick={() => setCheckout(true)}>
              <span className="play-now-label">Unlock Chaos+</span>
              <span className="play-now-sub">Demo checkout · no real payment</span>
            </button>
            <p className="dim small">Every level, mode and daily challenge remains free. Chaos+ never affects difficulty or scores.</p>
          </section>
        )}
      </div>
      {checkout && (
        <DemoCheckout
          item="Chaos+ (one-time)"
          price="₹99"
          onConfirm={() => {
            setCheckout(false);
            props.onUnlock();
          }}
          onCancel={() => setCheckout(false)}
        />
      )}
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

