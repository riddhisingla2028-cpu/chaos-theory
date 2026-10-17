import type { CSSProperties, ReactNode } from 'react';
import type { AudioState } from '../game/audio';
import { shapeSvgPath } from '../game/shapes';
import type { ShapeId } from '../progress';

export function Overlay({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="overlay">
      <div className={`card${wide ? ' card-wide' : ''}`}>{children}</div>
    </div>
  );
}

export function Stars({ count, max = 3, animate = false }: { count: number; max?: number; animate?: boolean }) {
  return (
    <span className={`stars${animate ? ' stars-animate' : ''}`} aria-label={`${count} of ${max} stars`}>
      {Array.from({ length: max }, (_, i) => (
        <StarIcon key={i} filled={i < count} style={animate ? { animationDelay: `${0.25 + i * 0.22}s` } : undefined} />
      ))}
    </span>
  );
}

export function ShapePreview({ shape, size = 40 }: { shape: ShapeId; size?: number }) {
  return (
    <svg viewBox="-24 -24 48 48" width={size} height={size} aria-hidden="true">
      <path d={shapeSvgPath(shape, 12)} fill="currentColor" />
    </svg>
  );
}

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="back-btn" onClick={onClick} aria-label="Back to menu">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
      Back
    </button>
  );
}

export function StarIcon({ filled, style }: { filled: boolean; style?: CSSProperties }) {
  return (
    <svg className={`star${filled ? ' star-on' : ''}`} viewBox="0 0 24 24" width="22" height="22" style={style} aria-hidden="true">
      <path d="M12 2.8l2.7 5.9 6.4.7-4.8 4.3 1.3 6.3L12 16.8 6.4 20l1.3-6.3L2.9 9.4l6.4-.7z" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" fill="currentColor" />
      <rect x="14" y="5" width="4" height="14" fill="currentColor" />
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M7 5l12 7-12 7z" fill="currentColor" />
    </svg>
  );
}

export function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
      {muted ? (
        <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="2" />
      ) : (
        <path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" strokeWidth="2" />
      )}
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" fill="currentColor" />
      <path d="M8 11V8a4 4 0 018 0v3" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function IconButton({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" className="icon-btn" onClick={onClick} aria-label={label} title={label} disabled={disabled}>
      {children}
    </button>
  );
}

/**
 * Sound control that reflects the real audio state: muted, playing, blocked by the browser
 * (shows "Tap to enable sound") or unavailable on this device.
 */
export function SoundToggle({ muted, audioState, onToggle, onEnable }: { muted: boolean; audioState: AudioState; onToggle: () => void; onEnable: () => void }) {
  if (!muted && (audioState === 'suspended' || audioState === 'locked')) {
    return (
      <span className="sound-group">
        <button type="button" className="sound-enable" onClick={onEnable} aria-label="Tap to enable sound">
          <SoundIcon muted={false} />
          <span className="sound-long">Tap to enable sound</span>
          <span className="sound-short">Sound</span>
        </button>
        <IconButton label="Mute sound" onClick={onToggle}>
          <SoundIcon muted />
        </IconButton>
      </span>
    );
  }
  const unavailable = audioState === 'unavailable';
  return (
    <button
      type="button"
      className={`icon-btn${unavailable ? ' icon-btn-warn' : ''}`}
      onClick={onToggle}
      aria-label={unavailable ? 'Sound is not available on this device' : muted ? 'Unmute sound' : 'Mute sound'}
      aria-pressed={muted}
      title={unavailable ? 'Sound is not available on this device' : muted ? 'Unmute sound' : 'Mute sound'}
    >
      <SoundIcon muted={muted || unavailable} />
    </button>
  );
}
