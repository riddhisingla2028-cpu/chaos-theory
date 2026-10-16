// Server-side verification of Chaos+ purchases. Runs ONLY on the server (a Cloudflare Pages
// Function, see functions/api/verify-license.ts). The browser never decides whether a purchase
// is valid: it sends the license key it was emailed, and this code asks Gumroad.
//
// Gumroad is the merchant of record: it takes the payment, handles tax and refunds, and emails
// the buyer a license key. Gumroad's verify endpoint needs no secret, only the product id
// (kept in server configuration) and the key.

export const GUMROAD_VERIFY_URL = 'https://api.gumroad.com/v2/licenses/verify';
/** One purchase may be activated on this many devices or browsers. */
export const MAX_ACTIVATIONS = 5;

export type LicenseResult =
  | { valid: true; purchaseId: string; activations: number }
  | { valid: false; reason: 'bad-key' | 'not-found' | 'refunded' | 'chargeback' | 'too-many-devices' | 'not-configured' | 'unavailable' };

/** Gumroad license keys look like 8 groups of hex: ABCD1234-ABCD1234-ABCD1234-ABCD1234. */
export function normaliseLicenseKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const k = raw.trim().toUpperCase();
  return /^[0-9A-F]{8}(-[0-9A-F]{8}){3}$/.test(k) ? k : null;
}

interface GumroadVerifyResponse {
  success?: boolean;
  uses?: number;
  purchase?: { id?: string; refunded?: boolean; chargebacked?: boolean; disputed?: boolean; dispute_won?: boolean };
}

/**
 * Ask Gumroad whether `key` is a real, unrefunded purchase of `productId`.
 * `activate` counts a new device (first activation); re-checks on later visits do not.
 */
export async function verifyLicense(
  opts: { key: unknown; productId: string | undefined; activate: boolean },
  fetchImpl: typeof fetch = fetch,
): Promise<LicenseResult> {
  if (!opts.productId) return { valid: false, reason: 'not-configured' };
  const key = normaliseLicenseKey(opts.key);
  if (!key) return { valid: false, reason: 'bad-key' };
  let res: Response;
  try {
    res = await fetchImpl(GUMROAD_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ product_id: opts.productId, license_key: key, increment_uses_count: opts.activate ? 'true' : 'false' }).toString(),
    });
  } catch {
    return { valid: false, reason: 'unavailable' };
  }
  // Gumroad answers 404 for unknown or disabled keys; 5xx means try again later.
  if (res.status === 404) return { valid: false, reason: 'not-found' };
  if (!res.ok) return { valid: false, reason: 'unavailable' };
  let body: GumroadVerifyResponse;
  try {
    body = (await res.json()) as GumroadVerifyResponse;
  } catch {
    return { valid: false, reason: 'unavailable' };
  }
  if (!body.success || !body.purchase?.id) return { valid: false, reason: 'not-found' };
  if (body.purchase.refunded) return { valid: false, reason: 'refunded' };
  if (body.purchase.chargebacked || (body.purchase.disputed && !body.purchase.dispute_won)) return { valid: false, reason: 'chargeback' };
  const uses = Number(body.uses ?? 0);
  if (uses > MAX_ACTIVATIONS) return { valid: false, reason: 'too-many-devices' };
  return { valid: true, purchaseId: body.purchase.id, activations: uses };
}

/** The HTTP handler, independent of the hosting platform. */
export async function handleVerifyRequest(req: Request, productId: string | undefined, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const json = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (req.method !== 'POST') return json(405, { valid: false, reason: 'method' });
  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > 1024) return json(413, { valid: false, reason: 'bad-key' });
  let input: { key?: unknown; activate?: unknown };
  try {
    input = (await req.json()) as typeof input;
  } catch {
    return json(400, { valid: false, reason: 'bad-key' });
  }
  const result = await verifyLicense({ key: input?.key, productId, activate: input?.activate === true }, fetchImpl);
  // Only a short purchase reference goes back to the browser; no buyer email or details.
  const out = result.valid ? { valid: true, ref: result.purchaseId.slice(-6) } : result;
  return json(result.valid ? 200 : result.reason === 'unavailable' ? 503 : result.reason === 'not-configured' ? 501 : 200, out);
}
