import { useState } from 'react';
import { ACHIEVEMENTS, SHAPES, THEMES, type Progress, type Settings, type ShapeId, type ThemeId } from '../progress';
import { BackButton, LockIcon, Overlay, ShapePreview } from './common';

// ---------- Collection ----------

export function Collection(props: {
  progress: Progress;
  onShape: (id: ShapeId) => void;
  onTheme: (id: ThemeId) => void;
  onPremium: () => void;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<'skins' | 'themes' | 'achievements'>('skins');
  const p = props.progress;
  const lockedText = (req: string, premium?: boolean) => (premium ? 'Chaos+ exclusive' : req);
  return (
    <div className="screen collection">
      <header className="screen-top">
        <BackButton onClick={props.onBack} />
        <h2 className="screen-heading">Collection</h2>
        <span className="player-chip">
          {p.achievements.length}/{ACHIEVEMENTS.length}
        </span>
      </header>
      <div className="screen-scroll">
        <div className="tabs" role="tablist">
          {(['skins', 'themes', 'achievements'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={`tab${tab === t ? ' tab-on' : ''}`} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>

        {tab === 'skins' && (
          <div className="pick-grid">
            {SHAPES.map((s) => {
              const open = s.unlocked(p);
              const on = p.settings.shape === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`pick${on ? ' pick-on' : ''}${open ? '' : ' locked'}${s.premium ? ' pick-plus' : ''}`}
                  onClick={() => (open ? props.onShape(s.id) : s.premium ? props.onPremium() : undefined)}
                  aria-disabled={!open}
                >
                  {s.premium && <span className="pick-badge">Plus</span>}
                  <span className="pick-art">{open ? <ShapePreview shape={s.id} /> : <LockIcon />}</span>
                  <span className="pick-name">{s.name}</span>
                  <span className="pick-req">{on ? 'Equipped' : open ? 'Tap to equip' : lockedText(s.req, s.premium)}</span>
                </button>
              );
            })}
          </div>
        )}

        {tab === 'themes' && (
          <div className="pick-grid">
            {THEMES.map((t) => {
              const open = t.unlocked(p);
              const on = p.settings.theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`pick${on ? ' pick-on' : ''}${open ? '' : ' locked'}${t.premium ? ' pick-plus' : ''}`}
                  onClick={() => (open ? props.onTheme(t.id) : t.premium ? props.onPremium() : undefined)}
                  aria-disabled={!open}
                >
                  {t.premium && <span className="pick-badge">Plus</span>}
                  <span className="pick-art swatch" style={{ background: t.arena }}>
                    {open ? <span className="swatch-dot" style={{ background: `rgb(${t.accent.join(',')})` }} /> : <LockIcon />}
                  </span>
                  <span className="pick-name">{t.name}</span>
                  <span className="pick-req">{on ? 'Equipped' : open ? 'Tap to equip' : lockedText(t.req, t.premium)}</span>
                </button>
              );
            })}
          </div>
        )}

        {tab === 'achievements' && (
          <ul className="ach-list">
            {ACHIEVEMENTS.map((a) => {
              const got = p.achievements.includes(a.id);
              return (
                <li key={a.id} className={got ? 'ach-got' : ''}>
                  <span className="ach-mark" aria-hidden="true">
                    {got ? '✓' : ''}
                  </span>
                  <span className="ach-text">
                    <span className="ach-name">{a.name}</span>
                    <span className="ach-desc">{a.desc}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------- Settings ----------

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={`seg${value === v ? ' seg-on' : ''}`} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function SettingsScreen(props: { settings: Settings; onChange: (s: Partial<Settings>) => void; onReset: () => void; onBack: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const s = props.settings;
  return (
    <div className="screen settings">
      <header className="screen-top">
        <BackButton onClick={props.onBack} />
        <h2 className="screen-heading">Settings</h2>
        <span />
      </header>
      <div className="screen-scroll narrow">
        <div className="setting">
          <span className="setting-label">Sound effects</span>
          <Segmented label="Sound" value={s.muted ? 'off' : 'on'} options={[['on', 'On'], ['off', 'Off']]} onChange={(v) => props.onChange({ muted: v === 'off' })} />
        </div>
        <div className="setting">
          <span className="setting-label">
            Menu music
            <span className="setting-help">Ambient synth in the menus.</span>
          </span>
          <Segmented label="Music" value={s.music ? 'on' : 'off'} options={[['on', 'On'], ['off', 'Off']]} onChange={(v) => props.onChange({ music: v === 'on' })} />
        </div>
        <div className="setting">
          <span className="setting-label">Screen shake</span>
          <Segmented label="Screen shake" value={s.shake ? 'on' : 'off'} options={[['on', 'On'], ['off', 'Off']]} onChange={(v) => props.onChange({ shake: v === 'on' })} />
        </div>
        <div className="setting">
          <span className="setting-label">
            Touch joystick
            <span className="setting-help">Floating appears where you touch. Fixed stays in one place.</span>
          </span>
          <Segmented label="Touch joystick" value={s.joyMode} options={[['float', 'Floating'], ['fixed', 'Fixed']]} onChange={(v) => props.onChange({ joyMode: v })} />
        </div>
        <div className="setting">
          <span className="setting-label">
            Joystick size
            <span className="setting-help">Smaller is more sensitive.</span>
          </span>
          <Segmented label="Joystick size" value={s.joySize} options={[['S', 'S'], ['M', 'M'], ['L', 'L']]} onChange={(v) => props.onChange({ joySize: v })} />
        </div>
        <div className="setting setting-danger">
          <span className="setting-label">
            Reset progress
            <span className="setting-help">Clears stars, bests, achievements, unlocks and records.</span>
          </span>
          {confirming ? (
            <span className="confirm-row">
              <button
                type="button"
                className="btn btn-small btn-danger"
                onClick={() => {
                  props.onReset();
                  setConfirming(false);
                }}
              >
                Confirm
              </button>
              <button type="button" className="btn btn-small" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="btn btn-small" onClick={() => setConfirming(true)}>
              Reset
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Tutorial ----------

export function Tutorial({ isTouch, onDone }: { isTouch: boolean; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const steps = [
    {
      title: 'Move',
      body: isTouch ? 'Drag anywhere on the screen. A joystick appears under your thumb.' : 'Use WASD or the arrow keys. Press P or Esc to pause.',
      art: 'move',
    },
    { title: 'Survive', body: 'Red means danger. Brushing past hazards without touching them builds your score multiplier.', art: 'survive' },
    { title: 'Collect', body: 'Some levels ask you to grab glowing orbs. Each one is worth points and boosts your combo.', art: 'orb' },
    { title: 'Expect chaos', body: 'A banner warns you before the rules change. You get a moment to read it, then adapt fast.', art: 'chaos' },
  ];
  const cur = steps[step];
  const last = step === steps.length - 1;
  return (
    <Overlay>
      <p className="kicker">
        How to play · {step + 1}/{steps.length}
      </p>
      <div className={`tut-art tut-${cur.art}`} aria-hidden="true">
        <span className="tut-player" />
        <span className="tut-hazard" />
        <span className="tut-orb" />
        <span className="tut-banner">Incoming</span>
      </div>
      <h2 className="title title-sm">{cur.title}</h2>
      <p className="lede">{cur.body}</p>
      <div className="dots" aria-hidden="true">
        {steps.map((_, i) => (
          <span key={i} className={i === step ? 'dot-on' : ''} />
        ))}
      </div>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={() => (last ? onDone() : setStep(step + 1))} autoFocus>
          {last ? "Let's go" : 'Next'}
        </button>
        {!last && (
          <button type="button" className="btn" onClick={onDone}>
            Skip
          </button>
        )}
      </div>
    </Overlay>
  );
}
