// Advertising architecture. Provider-agnostic and DISABLED: no ad network, no third-party
// scripts, no tracking. To go live later:
//   1. Implement AdProvider for an approved network (load its script only inside that provider).
//   2. Set AD_PROVIDER below to it.
//   3. Build with VITE_ADS_ENABLED=true.
// Until both are done, production renders no ad slots at all; development shows clearly
// labelled placeholders (hide them with VITE_AD_PLACEHOLDERS=false).

import { adsAllowedFor, type PremiumStatus } from './entitlements';

export type AdPlacementId = 'home_banner' | 'level_select_banner' | 'results_banner' | 'endless_results_banner';

export interface AdPlacement {
  id: AdPlacementId;
  description: string;
  /** Reserved height in px so the layout does not jump when an ad loads. */
  height: { mobile: number; desktop: number };
  maxWidth: number;
}

/** Ads are never placed over the arena: none of these appear during active gameplay. */
export const AD_PLACEMENTS: Record<AdPlacementId, AdPlacement> = {
  home_banner: { id: 'home_banner', description: 'Home screen, below the game modes', height: { mobile: 50, desktop: 90 }, maxWidth: 728 },
  level_select_banner: { id: 'level_select_banner', description: 'Level select, below the level grid', height: { mobile: 50, desktop: 60 }, maxWidth: 468 },
  results_banner: { id: 'results_banner', description: 'Level results, below the buttons', height: { mobile: 50, desktop: 60 }, maxWidth: 468 },
  endless_results_banner: { id: 'endless_results_banner', description: 'Endless results, below the buttons', height: { mobile: 50, desktop: 60 }, maxWidth: 468 },
};

export type InterstitialResult = 'shown' | 'skipped' | 'unavailable';
/** Rewarded ads report only what the provider confirms. Nothing here ever simulates a completed view. */
export interface RewardResult {
  completed: boolean;
}

/** Interface a real ad network integration must implement. */
export interface AdProvider {
  readonly id: string;
  /** Render a banner into the container. Resolve true only if an ad actually rendered. */
  renderBanner(placement: AdPlacement, container: HTMLElement): Promise<boolean>;
  destroyBanner?(placement: AdPlacement, container: HTMLElement): void;
  /** Optional full-screen ad between runs (never during gameplay). */
  showInterstitial?(placement: string): Promise<InterstitialResult>;
  /** Optional rewarded ad. Disabled until a real provider exists. */
  showRewarded?(placement: string): Promise<RewardResult>;
}

/** Deliberately null: no advertising network has been chosen or approved. */
export const AD_PROVIDER: AdProvider | null = null;

export interface FrequencyRule {
  minRunsBetween: number; // completed runs required between two ads
  cooldownMs: number; // minimum time between two ads
  maxPerSession: number;
}

export interface AdsConfig {
  enabled: boolean;
  placeholders: boolean;
  provider: AdProvider | null;
  interstitial: FrequencyRule;
  rewardedEnabled: boolean;
}

type Env = { DEV?: boolean; VITE_ADS_ENABLED?: string; VITE_AD_PLACEHOLDERS?: string };

export function adsConfigFrom(env: Env, provider: AdProvider | null = AD_PROVIDER): AdsConfig {
  return {
    // Live ads need BOTH an explicit opt-in and a configured provider.
    enabled: env.VITE_ADS_ENABLED === 'true' && provider !== null,
    placeholders: env.DEV === true && env.VITE_AD_PLACEHOLDERS !== 'false',
    provider,
    interstitial: { minRunsBetween: 3, cooldownMs: 3 * 60 * 1000, maxPerSession: 4 },
    rewardedEnabled: false,
  };
}

export const ADS_CONFIG: AdsConfig = adsConfigFrom(import.meta.env as Env);

export type SlotMode = 'hidden' | 'placeholder' | 'live';

/** What a slot should render, given the config and the player's verified entitlement. */
export function decideSlot(config: AdsConfig, premium: PremiumStatus): SlotMode {
  if (!adsAllowedFor(premium)) return 'hidden';
  if (config.enabled && config.provider) return 'live';
  if (config.placeholders) return 'placeholder';
  return 'hidden';
}

/** Frequency control for between-run ads: limits, cooldowns and a session cap. */
export class AdFrequency {
  private runsSince = Infinity;
  private lastShown = -Infinity;
  private shown = 0;

  constructor(private readonly rule: FrequencyRule) {}

  recordRun(): void {
    this.runsSince = this.runsSince === Infinity ? 1 : this.runsSince + 1;
  }

  canShow(now: number): boolean {
    const runsOk = this.runsSince === Infinity ? false : this.runsSince >= this.rule.minRunsBetween;
    return runsOk && now - this.lastShown >= this.rule.cooldownMs && this.shown < this.rule.maxPerSession;
  }

  recordShown(now: number): void {
    this.shown++;
    this.lastShown = now;
    this.runsSince = 0;
  }
}

/**
 * Called after a run ends. Never blocks or delays retrying: with no provider (today) it resolves
 * 'unavailable' immediately and the game carries on.
 */
export async function maybeShowInterstitial(config: AdsConfig, premium: PremiumStatus, freq: AdFrequency, now = Date.now()): Promise<InterstitialResult> {
  freq.recordRun();
  if (!config.enabled || !config.provider?.showInterstitial || !adsAllowedFor(premium)) return 'unavailable';
  if (!freq.canShow(now)) return 'skipped';
  try {
    const result = await config.provider.showInterstitial('post_game');
    if (result === 'shown') freq.recordShown(now);
    return result;
  } catch {
    return 'unavailable';
  }
}

/** Rewarded ads are not available until a real provider exists; nothing is ever granted without one. */
export async function requestRewarded(config: AdsConfig, placement: string): Promise<RewardResult> {
  if (!config.rewardedEnabled || !config.enabled || !config.provider?.showRewarded) return { completed: false };
  try {
    return await config.provider.showRewarded(placement);
  } catch {
    return { completed: false };
  }
}
