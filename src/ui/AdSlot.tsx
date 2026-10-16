import { createContext, useContext, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ADS_CONFIG, AD_PLACEMENTS, decideSlot, type AdPlacementId, type AdsConfig } from '../monetization/ads';
import type { PremiumStatus } from '../monetization/entitlements';

/** Provided once by the app: config plus the verified entitlement. Components never check premium themselves. */
export const AdsContext = createContext<{ config: AdsConfig; premium: PremiumStatus }>({ config: ADS_CONFIG, premium: 'loading' });

/**
 * A reusable advertising slot. Renders:
 * - nothing, when ads are disabled or the player has a verified ad-free entitlement;
 * - a clearly marked development placeholder (dev builds only, no ad is loaded);
 * - a live provider banner, labelled "Advertisement" only once an ad has actually rendered.
 */
export function AdSlot({ placement, className = '' }: { placement: AdPlacementId; className?: string }) {
  const { config, premium } = useContext(AdsContext);
  const mode = decideSlot(config, premium);
  const p = AD_PLACEMENTS[placement];
  const style = { '--ad-h-mobile': `${p.height.mobile}px`, '--ad-h-desktop': `${p.height.desktop}px`, maxWidth: p.maxWidth } as CSSProperties;

  if (mode === 'hidden') return null;
  if (mode === 'placeholder') {
    return (
      <aside className={`ad-slot ad-placeholder ${className}`} style={style} data-placement={placement} aria-label="Advertising placeholder (development only)">
        <span className="ad-placeholder-text">
          Ad placeholder · <code>{placement}</code> · development only, no ad is loaded
        </span>
      </aside>
    );
  }
  return <LiveAd placement={placement} className={className} style={style} />;
}

function LiveAd({ placement, className, style }: { placement: AdPlacementId; className: string; style: CSSProperties }) {
  const { config } = useContext(AdsContext);
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');

  useEffect(() => {
    const el = ref.current;
    const provider = config.provider;
    if (!el || !provider) return;
    let cancelled = false;
    provider
      .renderBanner(AD_PLACEMENTS[placement], el)
      .then((ok) => !cancelled && setState(ok ? 'loaded' : 'failed'))
      .catch(() => !cancelled && setState('failed'));
    return () => {
      cancelled = true;
      provider.destroyBanner?.(AD_PLACEMENTS[placement], el);
    };
  }, [config.provider, placement]);

  // No fill: collapse quietly rather than show an empty or fake ad.
  if (state === 'failed') return null;
  return (
    <aside className={`ad-slot ${className}`} style={style} data-placement={placement} aria-label="Advertisement">
      {state === 'loaded' && <span className="ad-label">Advertisement</span>}
      <div ref={ref} className="ad-frame" />
    </aside>
  );
}
