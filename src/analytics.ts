// Privacy-conscious launch analytics. OFF unless configured; nothing is sent otherwise.
//
// Uses Umami (https://umami.is): no cookies, no personal data, honours Do Not Track.
// Configure at build time:
//   VITE_UMAMI_WEBSITE_ID  the website id from the Umami dashboard
//   VITE_UMAMI_SCRIPT      optional, defaults to https://cloud.umami.is/script.js
// Events carry only a name and, at most, a mode or level number. Never names, emails or keys.

export type AnalyticsEvent =
  | 'play_click' // the main Play button on the launcher
  | 'game_start' // any single-player run starts
  | 'game_complete' // a level is cleared (won)
  | 'mp_room_created'
  | 'mp_room_joined'
  | 'mp_match_started'
  | 'chaosplus_view'
  | 'checkout_start' // opened the Gumroad checkout
  | 'purchase_verified' // the server verified a license key with Gumroad
  | 'share_score';

type Props = Record<string, string | number>;
type Umami = { track: (name: string, data?: Props) => void };

export interface AnalyticsConfig {
  websiteId: string;
  script: string;
}

export function analyticsConfigFrom(env: Record<string, unknown>): AnalyticsConfig | null {
  const id = typeof env.VITE_UMAMI_WEBSITE_ID === 'string' ? env.VITE_UMAMI_WEBSITE_ID.trim() : '';
  const script = typeof env.VITE_UMAMI_SCRIPT === 'string' && env.VITE_UMAMI_SCRIPT.trim() ? env.VITE_UMAMI_SCRIPT.trim() : 'https://cloud.umami.is/script.js';
  if (!/^[0-9a-f-]{36}$/i.test(id) || !script.startsWith('https://')) return null;
  return { websiteId: id, script };
}

const CONFIG = analyticsConfigFrom(import.meta.env as unknown as Record<string, unknown>);
const queue: [AnalyticsEvent, Props | undefined][] = [];
let loaded = false;

/** Only plain, non-identifying values get through. */
export function cleanProps(p?: Record<string, unknown>): Props | undefined {
  if (!p) return undefined;
  const out: Props = {};
  for (const [k, v] of Object.entries(p)) {
    if (!/^[a-z_]{1,20}$/.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 100) / 100;
    else if (typeof v === 'string' && /^[a-z0-9_-]{1,24}$/i.test(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function umami(): Umami | null {
  return (window as unknown as { umami?: Umami }).umami ?? null;
}

export function initAnalytics(): void {
  if (!CONFIG || loaded || typeof document === 'undefined') return;
  loaded = true;
  const s = document.createElement('script');
  s.defer = true;
  s.src = CONFIG.script;
  s.dataset.websiteId = CONFIG.websiteId;
  s.dataset.doNotTrack = 'true';
  s.onload = () => {
    const u = umami();
    if (u) for (const [name, data] of queue.splice(0)) u.track(name, data);
  };
  document.head.appendChild(s);
}

export function track(name: AnalyticsEvent, props?: Record<string, unknown>): void {
  if (!CONFIG) return;
  const data = cleanProps(props);
  try {
    const u = umami();
    if (u) u.track(name, data);
    else if (queue.length < 50) queue.push([name, data]);
  } catch {
    // Analytics must never affect the game.
  }
}

export const ANALYTICS_ENABLED = CONFIG !== null;
