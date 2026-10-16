// Central entitlement service: the ONE place that decides whether a player has Chaos+.
//
// Chaos+ comes only from a purchase that the SERVER has verified with the payment provider
// (Gumroad, see server/license.ts). The browser keeps the buyer's license key so it can ask again
// on each visit, but the key on its own proves nothing: every check goes to /api/verify-license,
// and a refunded or charged-back purchase stops working on the next check.
//
// Purchases are switched on only when all of these public settings are present at build time:
//   VITE_CHAOSPLUS_CHECKOUT_URL  the Gumroad product page (https://….gumroad.com/l/…)
//   VITE_CHAOSPLUS_PRICE         the price label shown in the game, e.g. "US$3" (must match Gumroad)
//   VITE_SUPPORT_EMAIL           where buyers can ask for help or a refund
// Without them the Chaos+ page says "Coming soon" and nothing can be bought.

export type PremiumStatus =
  | 'loading' // verification in progress: show no ads yet, to avoid a flash for premium players
  | 'free' // no verified purchase
  | 'premium' // a server-verified purchase
  | 'unavailable'; // verification failed (offline, server error): treated like free

export interface PurchaseVerifier {
  readonly id: string;
  /** Must be answered by a server, never by client-side state. */
  verify(): Promise<{ verified: boolean; premium: boolean }>;
}

export interface StoreConfig {
  checkoutUrl: string;
  price: string;
  supportEmail: string;
}

export function storeConfigFrom(env: Record<string, unknown>): StoreConfig | null {
  const s = (k: string) => (typeof env[k] === 'string' ? (env[k] as string).trim() : '');
  const checkoutUrl = s('VITE_CHAOSPLUS_CHECKOUT_URL');
  const price = s('VITE_CHAOSPLUS_PRICE');
  const supportEmail = s('VITE_SUPPORT_EMAIL');
  if (!/^https:\/\/([a-z0-9-]+\.)*gumroad\.com\/l\/[A-Za-z0-9_-]+/.test(checkoutUrl)) return null;
  if (!price || price.length > 20 || !/\d/.test(price)) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) return null;
  return { checkoutUrl, price, supportEmail };
}

export const STORE = storeConfigFrom(import.meta.env as unknown as Record<string, unknown>);

/** Whether buying Chaos+ is possible in this build. */
export const PURCHASES_AVAILABLE = STORE !== null;

// ---------- License keys ----------

const KEY_STORE = 'chaos-theory.chaosplus.license';
const VERIFY_ENDPOINT = '/api/verify-license';

export type LicenseFailure = 'bad-key' | 'not-found' | 'refunded' | 'chargeback' | 'too-many-devices' | 'not-configured' | 'unavailable';

export const LICENSE_MESSAGES: Record<LicenseFailure, string> = {
  'bad-key': 'That does not look like a Chaos+ license key. Copy it exactly from your Gumroad receipt email.',
  'not-found': 'That key was not found for Chaos+. Check it against your Gumroad receipt.',
  refunded: 'That purchase was refunded, so Chaos+ is no longer active.',
  chargeback: 'That purchase is disputed or was charged back, so Chaos+ is not active.',
  'too-many-devices': 'That key has been used on too many devices. Contact support and we will reset it.',
  'not-configured': 'Purchases are not set up on this server yet.',
  unavailable: 'Could not reach the purchase check right now. Please try again in a minute.',
};

function keyStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const savedLicenseKey = (): string | null => keyStorage()?.getItem(KEY_STORE) ?? null;

async function askServer(key: string, activate: boolean, fetchImpl: typeof fetch = fetch): Promise<{ valid: boolean; reason?: LicenseFailure }> {
  const res = await fetchImpl(VERIFY_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, activate }) });
  const data = (await res.json().catch(() => null)) as { valid?: boolean; reason?: LicenseFailure } | null;
  if (!data || typeof data.valid !== 'boolean') throw new Error('bad response');
  return { valid: data.valid, reason: data.reason };
}

/** First activation on this device, from the key the buyer typed in. */
export async function activateLicense(rawKey: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; reason: LicenseFailure }> {
  const key = rawKey.trim().toUpperCase();
  if (!/^[0-9A-F]{8}(-[0-9A-F]{8}){3}$/.test(key)) return { ok: false, reason: 'bad-key' };
  try {
    const r = await askServer(key, true, fetchImpl);
    if (!r.valid) return { ok: false, reason: r.reason ?? 'not-found' };
    keyStorage()?.setItem(KEY_STORE, key);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

export function forgetLicense(): void {
  keyStorage()?.removeItem(KEY_STORE);
}

/** Re-checks the saved key with the server on every visit. */
export const licenseVerifier = (fetchImpl: typeof fetch = fetch): PurchaseVerifier => ({
  id: 'gumroad-license',
  async verify() {
    const key = savedLicenseKey();
    if (!key) return { verified: true, premium: false };
    const r = await askServer(key, false, fetchImpl);
    if (!r.valid && r.reason === 'unavailable') throw new Error('unavailable');
    // A refunded or unknown key is removed so it is not re-sent on every visit.
    if (!r.valid && r.reason !== 'not-configured') forgetLicense();
    return { verified: true, premium: r.valid };
  },
});

export const PURCHASE_VERIFIER: PurchaseVerifier | null = PURCHASES_AVAILABLE ? licenseVerifier() : null;

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
