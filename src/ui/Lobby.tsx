import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';

import { ENDLESS_MODES, STAGES, TRIALS, objectiveText, type EndlessId, type Mutator } from '../game/stages';
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
  SHIPS,
  missionsCompleted,
  nextMission,
  chaosPlusUnlocked,
  hasVerifiedChaosPlus,
  PREVIEW_AVAILABLE,
  type Progress,
  type RecordEntry,
} from '../progress';
import { challengeById, currentChallenges, weekKeyOf } from '../progression';
import { MISSIONS } from '../mission/sim';
import { AdSlot } from './AdSlot';
import { LICENSE_MESSAGES, STORE, activateLicense, forgetLicense, type PremiumStatus } from '../monetization/entitlements';
import type { AudioState } from '../game/audio';
import { BackButton, LockIcon, ShapePreview, SoundToggle, Stars } from './common';

const rgb = (c: [number, number, number]) => `rgb(${c.join(',')})`;

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

// ---------- Home ----------

export function HomeScreen(props: {
  progress: Progress;
  daily: { mutator: Mutator; best: number };
  muted: boolean;
  audioState: AudioState;
  isTouch: boolean;
  onToggleSound: () => void;
  onEnableSound: () => void;
  onContinue: () => void;
  onNewMission: () => void;
  onHangar: () => void;
  onLevels: () => void;
  onModes: () => void;
  onDaily: () => void;
  onTrials: () => void;
  onCollection: () => void;
  onRecords: () => void;
  onSettings: () => void;
  onPremium: () => void;
  onProfile: () => void;
  onMultiplayer: () => void;
  onTutorial: () => void;
}) {
  const p = props.progress;
  const cleared = levelsCleared(p);
  const done = missionsCompleted(p);
  const nm = MISSIONS[nextMission(p)];
  const started = Object.keys(p.missions).length > 0;
  const allDone = done === MISSIONS.length;
  const playSub = allDone ? 'All missions complete · fly them again for stars' : `Mission ${nm.code} · ${nm.name}`;
  const ships = SHIPS.filter((sh) => sh.unlocked(p)).length;
  const lvl = accountLevel(p);
  const today = currentChallenges(p.challenges, new Date()).daily!;
  const todayDone = today.done.filter(Boolean).length;
  const nextChallenge = today.ids.map((id, i) => (today.done[i] ? null : challengeById(id)?.text)).find(Boolean) ?? null;
  return (
    <div className="screen home">
      <header className="topbar home-topbar">
        <button type="button" className="profile-chip" onClick={props.onProfile} aria-label={`Profile: account level ${lvl.level}`}>
          <ShapePreview shape={p.settings.shape} size={18} />
          <span className="profile-chip-level">Lv {lvl.level}</span>
          <span className="profile-chip-bar" aria-hidden="true">
            <span style={{ transform: `scaleX(${lvl.need ? lvl.into / lvl.need : 1})` }} />
          </span>
        </button>
        <div className="topbar-right">
          <span className="player-chip" title="Stars earned">
            ★ {totalStars(p)}
            <span className="dim">/{maxStars()}</span>
          </span>
          {hasVerifiedChaosPlus() ? <span className="plus-chip">Chaos+</span> : p.premiumDemo && PREVIEW_AVAILABLE && <span className="plus-chip">Preview</span>}
          <SoundToggle muted={props.muted} audioState={props.audioState} onToggle={props.onToggleSound} onEnable={props.onEnableSound} />
        </div>
      </header>

      <main className="home-main">
        <section className="hero">
          <p className="eyebrow home-free">Free · no download · no sign-up</p>
          <h1 className="logo logo-xl" data-text="CHAOS THEORY">
            <span>CHAOS</span>
            <span>THEORY</span>
          </h1>
          <p className="hero-tag">Reality is unstable. Your mission isn&rsquo;t.</p>
          <button type="button" className="play-now" onClick={props.onContinue} autoFocus style={{ '--lvl': rgb(nm.accent) } as CSSProperties}>
            <span className="play-now-label">{started ? 'Continue campaign' : 'Start campaign'}</span>
            <span className="play-now-sub">{playSub}</span>
          </button>
          <div className="campaign" aria-label={`${done} of ${MISSIONS.length} missions completed`}>
            <div className="campaign-bar">
              <span style={{ transform: `scaleX(${done / MISSIONS.length})` }} />
            </div>
            <span className="campaign-text">
              Missions {done}/{MISSIONS.length}
            </span>
          </div>
        </section>

        <section className="mode-tiles" aria-label="Game modes">
          <ModeTile title="New mission" meta={`${MISSIONS.length} missions`} glyph="target" onClick={props.onNewMission} featured />
          <ModeTile title="Endless mode" meta="4 survival modes" glyph="infinity" onClick={props.onModes} />
          <ModeTile title="Play with friends" meta="Multiplayer · private rooms for 2–6" glyph="players" onClick={props.onMultiplayer} wide accent="friends" />
          <ModeTile title="Arena levels" meta={`${cleared}/${STAGES.length} cleared`} glyph="map" onClick={props.onLevels} />
          <ModeTile title="Daily" meta={`${props.daily.mutator.name}${props.daily.best ? ` · ${props.daily.best.toLocaleString()}` : ''}`} glyph="sun" onClick={props.onDaily} />
          <ModeTile title="Trials" meta={chaosPlusUnlocked(p) ? `${TRIALS.length} bonus challenges` : 'Chaos+'} glyph="bolt" onClick={props.onTrials} badge={!chaosPlusUnlocked(p) ? 'Plus' : undefined} />
          <ModeTile title="Hangar" meta={`Ships ${ships}/${SHIPS.length}`} glyph="ship" onClick={props.onHangar} />
        </section>

        <button type="button" className="today" onClick={props.onProfile} aria-label={`Today's challenges: ${todayDone} of ${today.ids.length} done. Open profile`}>
          <span className="today-head">
            <span className="today-title">Today&rsquo;s challenges</span>
            <span className="today-count">
              {todayDone}/{today.ids.length} done ›
            </span>
          </span>
          {nextChallenge && <span className="today-next">Next: {nextChallenge}</span>}
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

      <nav className="tab-bar" aria-label="More">
        <TabButton label="Profile" icon="profile" onClick={props.onProfile} />
        <TabButton label="Collection" icon="collection" onClick={props.onCollection} />
        <TabButton label="Records" icon="records" onClick={props.onRecords} />
        <TabButton label="Chaos+" icon="plus" onClick={props.onPremium} plus />
        <TabButton label="Settings" icon="settings" onClick={props.onSettings} />
        <TabButton label="How to play" icon="help" onClick={props.onTutorial} />
      </nav>
    </div>
  );
}

function TabButton({ label, icon, onClick, plus }: { label: string; icon: string; onClick: () => void; plus?: boolean }) {
  const c = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <button type="button" className={`tab-btn${plus ? ' tab-plus' : ''}`} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        {icon === 'profile' && (
          <g {...c}>
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c1-4.5 4.5-6.5 8-6.5s7 2 8 6.5" />
          </g>
        )}
        {icon === 'collection' && <path {...c} d="M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v6H4zM13 14h7v6h-7z" />}
        {icon === 'records' && <path {...c} d="M8 4h8v5a4 4 0 01-8 0zM5 5h3v3a3 3 0 01-3-3zM19 5h-3v3a3 3 0 003-3zM12 13v4M8 20h8" />}
        {icon === 'plus' && <path {...c} d="M12 4v16M4 12h16" />}
        {icon === 'settings' && (
          <g {...c}>
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
          </g>
        )}
        {icon === 'help' && (
          <g {...c}>
            <circle cx="12" cy="12" r="9" />
            <path d="M9.5 9.5a2.5 2.5 0 015 .3c0 1.7-2.5 2-2.5 3.7M12 17h.01" />
          </g>
        )}
      </svg>
      <span>{label}</span>
    </button>
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
      {name === 'ship' && <path {...common} d="M28 16L12 10 6 4 8 13 8 19 6 28 12 22z" />}
      {name === 'target' && (
        <g {...common}>
          <circle cx="16" cy="16" r="10" />
          <circle cx="16" cy="16" r="4" />
          <path d="M16 2v6M16 24v6M2 16h6M24 16h6" />
        </g>
      )}
      {name === 'players' && (
        <g {...common}>
          <circle cx="11" cy="11" r="4" />
          <circle cx="22" cy="13" r="3.2" />
          <path d="M4 26c0-5 3.5-8 7-8s7 3 7 8M17 25c.5-3.5 2.6-6 5-6s4.6 2.2 5 6" />
        </g>
      )}
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

function ModeTile(props: { title: string; meta: string; glyph: string; onClick: () => void; badge?: string; featured?: boolean; wide?: boolean; accent?: 'friends' }) {
  const { title, meta, glyph, onClick, badge, featured, wide, accent } = props;
  return (
    <button type="button" className={`mode-tile${featured ? ' mode-tile-featured' : ''}${wide ? ' mode-tile-wide' : ''}${accent ? ` mode-tile-${accent}` : ''}`} onClick={onClick}>
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

export function LevelMap(props: { progress: Progress; initial: number; onPlay: (i: number) => void; onBack: () => void }) {
  const p = props.progress;
  const current = nextStage(p);
  const cleared = levelsCleared(p);
  const focusRef = useRef<HTMLButtonElement>(null);

  // Bring the level to play next into view (and keyboard focus) when the list opens.
  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: 'center' });
    focusRef.current?.focus({ preventScroll: true });
  }, []);

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
      <div className="screen-scroll levels-scroll">
        <div className="levels-progress" aria-label={`${cleared} of ${STAGES.length} levels cleared`}>
          <div className="campaign-bar">
            <span style={{ transform: `scaleX(${cleared / STAGES.length})` }} />
          </div>
          <span className="campaign-text">
            {cleared}/{STAGES.length} cleared · tap a level to play
          </span>
        </div>
        <ol className="level-list">
          {STAGES.map((st, i) => {
            const open = isStageUnlocked(p, i);
            const rec = p.stages[i];
            const done = isCleared(p, i);
            const skipped = isSkipped(p, i);
            const isNext = i === current;
            const cls = ['level-node', 'level-card', open ? '' : 'locked', done ? 'cleared' : '', skipped ? 'skipped' : '', isNext ? 'current' : ''].filter(Boolean).join(' ');
            const status = done ? `Best ${rec!.best.toLocaleString()}` : skipped ? 'Skipped · clear it to earn stars' : open ? (isNext ? 'Up next' : 'Not cleared yet') : `Clear level ${i} to unlock`;
            return (
              <li key={st.name} style={{ '--lvl': rgb(st.accent) } as CSSProperties}>
                <button
                  type="button"
                  ref={i === (props.initial >= 0 ? props.initial : current) ? focusRef : undefined}
                  className={cls}
                  onClick={() => open && props.onPlay(i)}
                  aria-disabled={!open}
                  aria-label={`${open ? 'Play level' : 'Locked: level'} ${i + 1}, ${st.name}. ${st.arena.name}. ${objectiveText(st.objective)}. ${status}`}
                >
                  <span className="lc-num" aria-hidden="true">
                    {open ? String(i + 1).padStart(2, '0') : <LockIcon />}
                  </span>
                  <span className="lc-main">
                    <span className="lc-name">{st.name}</span>
                    <span className="lc-meta">
                      {st.arena.name} · {objectiveText(st.objective)}
                    </span>
                    <span className="lc-desc">{open ? st.tagline : st.teaser}</span>
                  </span>
                  <span className="lc-side">
                    {done ? <Stars count={rec!.stars} /> : <Pips value={st.difficulty} />}
                    <span className={`lc-status${isNext ? ' lc-next' : ''}`}>{open ? (done ? status : skipped ? 'Skipped' : 'Play ▸') : 'Locked'}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="levels-hint">Each level has four phases. Clearing one unlocks the next; scoring well earns up to three stars.</p>
        <AdSlot placement="level_select_banner" />
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

export function ModesScreen(props: { progress: Progress; initial: EndlessId; onStart: (id: EndlessId) => void; onBack: () => void }) {
  const [selected, setSelected] = useState<EndlessId>(props.initial);
  const mode = ENDLESS_MODES.find((m) => m.id === selected)!;
  const best = props.progress.modeBests[selected];
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
  const [tab, setTab] = useState<RecordEntry['mode'] | 'week'>('endless');
  const thisWeek = weekKeyOf(new Date());
  const rows =
    tab === 'week'
      ? p.history
          .filter((h) => h.score > 0 && weekKeyOf(new Date(h.date)) === thisWeek)
          .map((h) => ({ mode: h.mode, label: h.label, score: h.score, time: h.time, date: h.date }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 10)
      : p.records.filter((r) => r.mode === tab).sort((a, b) => b.score - a.score);
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
            <button type="button" role="tab" aria-selected={tab === 'week'} className={`tab${tab === 'week' ? ' tab-on' : ''}`} onClick={() => setTab('week')}>
              This week
            </button>
            {MODE_TABS.map((t) => (
              <button key={t.mode} type="button" role="tab" aria-selected={tab === t.mode} className={`tab${tab === t.mode ? ' tab-on' : ''}`} onClick={() => setTab(t.mode)}>
                {t.label}
              </button>
            ))}
          </div>
          {rows.length === 0 ? (
            <p className="board-empty">{tab === 'week' ? 'No runs this week yet. Your best runs since Monday will appear here.' : 'No runs yet. Your top 10 will appear here.'}</p>
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
          <p className="board-note">
            Local leaderboard: your own runs on this device only. A global leaderboard needs a server, which is not set up yet.
          </p>
        </section>
      </div>
    </div>
  );
}

// ---------- Chaos+ ----------

const PREMIUM_STATUS_TEXT: Record<PremiumStatus, string> = {
  loading: 'Checking purchase status…',
  free: 'Not purchased on this device',
  premium: 'Chaos+ active · verified purchase',
  unavailable: 'Purchase status could not be checked right now',
};

export function PremiumScreen(props: {
  progress: Progress;
  premiumStatus: PremiumStatus;
  onPreviewCosmetics: (on: boolean) => void;
  onPlayTrial: (i: number) => void;
  onLicenseActivated: () => void;
  onLicenseRemoved: () => void;
  onCheckout: () => void;
  onLegal: () => void;
  onBack: () => void;
}) {
  const p = props.progress;
  const owned = props.premiumStatus === 'premium';
  const premiumShapes = SHAPES.filter((sh) => sh.premium);
  const premiumThemes = THEMES.filter((t) => t.premium);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const trialsOpen = chaosPlusUnlocked(p);

  const activate = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await activateLicense(key);
    setBusy(false);
    if (r.ok) {
      setKey('');
      props.onLicenseActivated();
    } else setMsg(LICENSE_MESSAGES[r.reason]);
  };

  return (
    <div className="screen premium">
      <header className="screen-top">
        <BackButton onClick={props.onBack} />
        <h2 className="screen-heading">Chaos+</h2>
        {owned ? <span className="plus-chip">Supporter</span> : !STORE ? <span className="demo-pill">Coming soon</span> : <span />}
      </header>
      <div className="screen-scroll">
        <section className="plus-hero">
          <p className="eyebrow">Optional one-time purchase · no gameplay advantage</p>
          <h1 className="plus-logo">
            CHAOS<span>+</span>
          </h1>
          <p className="hero-tag">
            {owned
              ? 'Thank you for supporting Chaos Theory. Your Chaos+ items are unlocked on this device.'
              : 'Support an independent game and get a supporter badge plus effects nobody else can unlock. Every level, mode and multiplayer room stays free.'}
          </p>
        </section>

        <section className="plus-buy">
          <p className="plus-status">{PREMIUM_STATUS_TEXT[props.premiumStatus]}</p>
          {STORE && !owned && (
            <>
              <a className="play-now play-now-plus" href={STORE.checkoutUrl} target="_blank" rel="noopener noreferrer" onClick={props.onCheckout}>
                <span className="play-now-label">Get Chaos+ · {STORE.price}</span>
                <span className="play-now-sub">One-time payment on Gumroad. Taxes, if any, are shown at checkout</span>
              </a>
              <ol className="plus-steps">
                <li>Pay on Gumroad&rsquo;s secure checkout (opens in a new tab). Gumroad handles the payment, receipt and any tax.</li>
                <li>Gumroad emails you a license key.</li>
                <li>Paste the key below. Our server checks it with Gumroad before anything unlocks.</li>
              </ol>
              <form className="account-form plus-key" onSubmit={(e) => void activate(e)}>
                <label>
                  License key
                  <input
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
                    autoComplete="off"
                    spellCheck={false}
                    autoCapitalize="characters"
                    required
                  />
                </label>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'Checking with Gumroad…' : 'Activate Chaos+'}
                </button>
              </form>
              {msg && (
                <p className="account-message" role="alert">
                  {msg}
                </p>
              )}
            </>
          )}
          {!STORE && (
            <>
              <button type="button" className="play-now play-now-plus" disabled aria-disabled="true">
                <span className="play-now-label">Coming soon</span>
                <span className="play-now-sub">Purchases open once the store is set up</span>
              </button>
              <p className="dim small">No payment is possible today, and nothing on this page charges money.</p>
            </>
          )}
          {owned && (
            <button type="button" className="btn btn-small" onClick={() => {
              forgetLicense();
              props.onLicenseRemoved();
            }}>
              Remove Chaos+ from this device
            </button>
          )}
          {STORE && (
            <p className="dim small">
              Questions, a lost key or a refund: <span className="select">{STORE.supportEmail}</span> ·{' '}
              <button type="button" className="link-btn" onClick={props.onLegal}>
                Refunds, terms and privacy
              </button>
            </p>
          )}
        </section>

        <section className="perk-grid">
          <Perk title="Supporter badge" text="A Chaos+ badge on your profile and on the score cards you share.">
            <span className="perk-art perk-icon">★</span>
          </Perk>
          <Perk title="Chaos+ only effects" text="The Halo trail and the Supernova victory effect. They cannot be unlocked by playing; only with Chaos+.">
            <span className="perk-art">
              <span className="trail-art trail-halo" />
              <span className="win-art win-supernova" />
            </span>
          </Perk>
          <Perk
            title="Chaos+ collection"
            text={`Two skins, two neon themes and two bonus trials.${PREVIEW_AVAILABLE ? ' Free to try in the preview below until purchases open.' : ''}`}
          >
            <span className="perk-art">
              {premiumShapes.map((sh) => (
                <ShapePreview key={sh.id} shape={sh.id} size={30} />
              ))}
              {premiumThemes.map((t) => (
                <span key={t.id} className="swatch-lg" style={{ background: t.arena, boxShadow: `inset 0 0 0 2px ${rgb(t.accent)}, 0 0 12px ${rgb(t.accent)}` }} />
              ))}
            </span>
          </Perk>
          <Perk title="No ad spaces" text="Chaos+ hides the ad placeholder panels in the menus. No ads or ad networks run in the game today; if real ads are ever added, supporters will not see them.">
            <span className="perk-art perk-icon">⊘</span>
          </Perk>
          <Perk title="Everything stays free" text="All 10 levels, Endless Modes, multiplayer, challenges, XP and the earned trails and victory effects stay free for everyone.">
            <span className="perk-art perk-icon">∞</span>
          </Perk>
        </section>


        {(PREVIEW_AVAILABLE || trialsOpen) && (
          <section className="plus-owned">
            <h3 className="section-title">{PREVIEW_AVAILABLE && !owned ? 'Cosmetics preview' : 'Bonus trials'}</h3>
            {PREVIEW_AVAILABLE && !owned && (
              <>
                <p className="dim small">
                  Try the Chaos+ collection and trials for free while purchases are unavailable. This is a preview: it is not a purchase, and it does not include the
                  supporter badge or the Chaos+ only effects.
                </p>
                <button type="button" className="btn btn-small" onClick={() => props.onPreviewCosmetics(!p.premiumDemo)}>
                  {p.premiumDemo ? 'Turn off cosmetics preview' : 'Preview cosmetics (free)'}
                </button>
              </>
            )}
            {trialsOpen && (
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
        )}
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

