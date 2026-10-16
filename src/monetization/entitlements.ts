// Central entitlement service: the ONE place that decides whether a player is premium (ad-free).
//
// Premium must come from a verified purchase confirmed by a server. Nothing stored in the browser
// (localStorage, the Chaos+ cosmetics demo, UI preferences) can grant it, because any of that can be
// edited by the player. Until a payment provider and verification backend are configured, every
// player is "free".

export type PremiumStatus =
  | 'loading' // verification in progress: show no ads yet, to avoid a flash for premium players
  | 'free' // no verified purchase
  | 'premium' // a server-verified purchase
  | 'unavailable'; // verification failed (offline, server error): treated like free

/** Implemented later by a real backend that checks purchase receipts. */
export interface PurchaseVerifier {
  readonly id: string;
  /** Must be answered by a server, never by client-side state. */
  verify(): Promise<{ verified: boolean; premium: boolean }>;
}

/**
 * Configure a verifier here once a payment provider and backend exist (for example a serverless
 * function that checks Stripe or Razorpay receipts). Deliberately null: no purchases exist yet.
 */
export const PURCHASE_VERIFIER: PurchaseVerifier | null = null;

/** Whether purchasing the ad-free upgrade is possible yet. */
export const PURCHASES_AVAILABLE = PURCHASE_VERIFIER !== null;

export async function resolvePremiumStatus(verifier: PurchaseVerifier | null = PURCHASE_VERIFIER): Promise<PremiumStatus> {
  if (!verifier) return 'free';
  try {
    const result = await verifier.verify();
    return result.verified && result.premium ? 'premium' : 'free';
  } catch {
    return 'unavailable';
  }
}

/** Ads may be shown to everyone except verified premium players, and not while status is loading. */
export function adsAllowedFor(status: PremiumStatus): boolean {
  return status === 'free' || status === 'unavailable';
}
