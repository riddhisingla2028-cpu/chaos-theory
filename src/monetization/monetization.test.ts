import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { AdFrequency, AD_PLACEMENTS, adsConfigFrom, decideSlot, maybeShowInterstitial, requestRewarded, type AdProvider } from './ads';
import { adsAllowedFor, resolvePremiumStatus } from './entitlements';
import { AdSlot, AdsContext } from '../ui/AdSlot';
import { defaultProgress, setPremiumDemo } from '../progress';

const provider: AdProvider = { id: 'test', renderBanner: async () => true, showInterstitial: async () => 'shown', showRewarded: async () => ({ completed: true }) };

describe('ads configuration', () => {
  it('is disabled by default: no provider, no live ads, even in production', () => {
    const prod = adsConfigFrom({ DEV: false });
    expect(prod.enabled).toBe(false);
    expect(decideSlot(prod, 'free')).toBe('hidden');
  });

  it('needs both an explicit opt-in AND a configured provider to go live', () => {
    expect(adsConfigFrom({ VITE_ADS_ENABLED: 'true' }, null).enabled).toBe(false);
    expect(adsConfigFrom({}, provider).enabled).toBe(false);
    expect(adsConfigFrom({ VITE_ADS_ENABLED: 'true' }, provider).enabled).toBe(true);
  });

  it('shows labelled placeholders only in development, and they can be turned off', () => {
    expect(decideSlot(adsConfigFrom({ DEV: true }), 'free')).toBe('placeholder');
    expect(decideSlot(adsConfigFrom({ DEV: true, VITE_AD_PLACEHOLDERS: 'false' }), 'free')).toBe('hidden');
  });

  it('defines the four placements with reserved heights', () => {
    expect(Object.keys(AD_PLACEMENTS).sort()).toEqual(['endless_results_banner', 'home_banner', 'level_select_banner', 'profile_banner', 'results_banner']);
    for (const p of Object.values(AD_PLACEMENTS)) expect(p.height.mobile).toBeGreaterThan(0);
  });
});

describe('entitlements', () => {
  it('only a verified premium purchase hides ads; loading hides them to avoid a flash', () => {
    const live = adsConfigFrom({ VITE_ADS_ENABLED: 'true' }, provider);
    expect(decideSlot(live, 'free')).toBe('live');
    expect(decideSlot(live, 'unavailable')).toBe('live');
    expect(decideSlot(live, 'premium')).toBe('hidden');
    expect(decideSlot(live, 'loading')).toBe('hidden');
    expect(decideSlot(adsConfigFrom({ DEV: true }), 'premium')).toBe('hidden');
  });

  it('with no verifier configured, everyone is free', async () => {
    expect(await resolvePremiumStatus(null)).toBe('free');
  });

  it('a local flag (the cosmetics demo) can never grant premium status', async () => {
    const demo = setPremiumDemo(defaultProgress(), true).progress;
    expect(demo.premiumDemo).toBe(true);
    expect(await resolvePremiumStatus()).toBe('free');
    expect(adsAllowedFor(await resolvePremiumStatus())).toBe(true);
  });

  it('trusts only a verifier that confirms a verified purchase, and fails safe', async () => {
    expect(await resolvePremiumStatus({ id: 'v', verify: async () => ({ verified: true, premium: true }) })).toBe('premium');
    expect(await resolvePremiumStatus({ id: 'v', verify: async () => ({ verified: false, premium: true }) })).toBe('free');
    expect(await resolvePremiumStatus({ id: 'v', verify: async () => Promise.reject(new Error('offline')) })).toBe('unavailable');
  });
});

describe('ad frequency and between-run ads', () => {
  it('respects minimum runs, cooldown and a session cap', () => {
    const f = new AdFrequency({ minRunsBetween: 2, cooldownMs: 1000, maxPerSession: 2 });
    f.recordRun();
    expect(f.canShow(0)).toBe(false); // only one run so far
    f.recordRun();
    expect(f.canShow(5000)).toBe(true);
    f.recordShown(5000);
    f.recordRun();
    f.recordRun();
    expect(f.canShow(5500)).toBe(false); // cooldown
    expect(f.canShow(7000)).toBe(true);
    f.recordShown(7000);
    f.recordRun();
    f.recordRun();
    expect(f.canShow(99999)).toBe(false); // session cap reached
  });

  it('with no provider, between-run ads are a no-op that never blocks', async () => {
    const f = new AdFrequency({ minRunsBetween: 0, cooldownMs: 0, maxPerSession: 9 });
    expect(await maybeShowInterstitial(adsConfigFrom({}), 'free', f)).toBe('unavailable');
  });

  it('never shows an interstitial to a verified premium player', async () => {
    const f = new AdFrequency({ minRunsBetween: 0, cooldownMs: 0, maxPerSession: 9 });
    expect(await maybeShowInterstitial(adsConfigFrom({ VITE_ADS_ENABLED: 'true' }, provider), 'premium', f)).toBe('unavailable');
  });

  it('rewarded ads are disabled: no reward is ever granted without a real provider', async () => {
    expect(await requestRewarded(adsConfigFrom({}), 'extra_life')).toEqual({ completed: false });
    expect(await requestRewarded(adsConfigFrom({ VITE_ADS_ENABLED: 'true' }, provider), 'extra_life')).toEqual({ completed: false });
  });
});

describe('AdSlot component', () => {
  const render = (config: ReturnType<typeof adsConfigFrom>, premium: 'free' | 'premium') =>
    renderToStaticMarkup(createElement(AdsContext.Provider, { value: { config, premium } }, createElement(AdSlot, { placement: 'results_banner' })));

  it('renders nothing when ads are disabled', () => {
    expect(render(adsConfigFrom({ DEV: false }), 'free')).toBe('');
  });

  it('renders a development placeholder labelled "Advertisement" with its intended size, clearly marked as a placeholder', () => {
    const html = render(adsConfigFrom({ DEV: true }), 'free');
    expect(html).toContain('>Advertisement<');
    expect(html).toContain('320 × 50');
    expect(html).toContain('468 × 60');
    expect(html).toContain('placeholder, development only');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<script');
  });

  it('renders nothing for a verified premium player', () => {
    expect(render(adsConfigFrom({ DEV: true }), 'premium')).toBe('');
  });

  it('a live slot does not claim an ad loaded until the provider confirms it', () => {
    const html = render(adsConfigFrom({ VITE_ADS_ENABLED: 'true' }, provider), 'free');
    expect(html).toContain('aria-label="Advertisement"');
    expect(html).not.toContain('class="ad-label"');
  });
});
