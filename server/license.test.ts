import { describe, expect, it, vi } from 'vitest';
import { GUMROAD_VERIFY_URL, MAX_ACTIVATIONS, handleVerifyRequest, normaliseLicenseKey, verifyLicense } from './license';

const KEY = 'ABCD1234-ABCD1234-ABCD1234-ABCD1234';
const gumroad = (status: number, body: unknown) =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
const good = (over: Record<string, unknown> = {}, uses = 1) => ({ success: true, uses, purchase: { id: 'purchase_abc123', refunded: false, chargebacked: false, ...over } });

describe('license key format', () => {
  it('accepts Gumroad keys in any case, rejects everything else', () => {
    expect(normaliseLicenseKey(` ${KEY.toLowerCase()} `)).toBe(KEY);
    expect(normaliseLicenseKey('ABCD1234')).toBeNull();
    expect(normaliseLicenseKey('ZZZZ1234-ABCD1234-ABCD1234-ABCD1234')).toBeNull();
    expect(normaliseLicenseKey(42)).toBeNull();
  });
});

describe('verifying a purchase with Gumroad (server side)', () => {
  it('grants Chaos+ only for a real, unrefunded purchase, and sends the server product id', async () => {
    const f = gumroad(200, good());
    const r = await verifyLicense({ key: KEY, productId: 'prod_1', activate: true }, f as unknown as typeof fetch);
    expect(r).toEqual({ valid: true, purchaseId: 'purchase_abc123', activations: 1 });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(GUMROAD_VERIFY_URL);
    const body = new URLSearchParams(String(init!.body));
    expect(body.get('product_id')).toBe('prod_1');
    expect(body.get('increment_uses_count')).toBe('true');
  });

  it('re-checks on later visits do not count as new devices', async () => {
    const f = gumroad(200, good());
    await verifyLicense({ key: KEY, productId: 'p', activate: false }, f as unknown as typeof fetch);
    expect(new URLSearchParams(String(f.mock.calls[0][1]!.body)).get('increment_uses_count')).toBe('false');
  });

  it('refunds and chargebacks remove the entitlement', async () => {
    expect(await verifyLicense({ key: KEY, productId: 'p', activate: false }, gumroad(200, good({ refunded: true })) as unknown as typeof fetch)).toEqual({ valid: false, reason: 'refunded' });
    expect(await verifyLicense({ key: KEY, productId: 'p', activate: false }, gumroad(200, good({ chargebacked: true })) as unknown as typeof fetch)).toEqual({ valid: false, reason: 'chargeback' });
    expect(await verifyLicense({ key: KEY, productId: 'p', activate: false }, gumroad(200, good({ disputed: true })) as unknown as typeof fetch)).toEqual({ valid: false, reason: 'chargeback' });
  });

  it('unknown keys, too many devices, outages and missing configuration all fail closed', async () => {
    expect((await verifyLicense({ key: KEY, productId: 'p', activate: true }, gumroad(404, { success: false }) as unknown as typeof fetch)).valid).toBe(false);
    expect(await verifyLicense({ key: KEY, productId: 'p', activate: true }, gumroad(200, good({}, MAX_ACTIVATIONS + 1)) as unknown as typeof fetch)).toEqual({ valid: false, reason: 'too-many-devices' });
    expect(await verifyLicense({ key: KEY, productId: 'p', activate: true }, gumroad(502, {}) as unknown as typeof fetch)).toEqual({ valid: false, reason: 'unavailable' });
    const boom = vi.fn(async () => {
      throw new Error('network');
    });
    expect(await verifyLicense({ key: KEY, productId: 'p', activate: true }, boom as unknown as typeof fetch)).toEqual({ valid: false, reason: 'unavailable' });
    expect(await verifyLicense({ key: KEY, productId: undefined, activate: true }, gumroad(200, good()) as unknown as typeof fetch)).toEqual({ valid: false, reason: 'not-configured' });
    expect((await verifyLicense({ key: 'nonsense', productId: 'p', activate: true }, gumroad(200, good()) as unknown as typeof fetch)).valid).toBe(false);
  });
});

describe('the /api/verify-license endpoint', () => {
  const post = (body: unknown) => new Request('https://game.example/api/verify-license', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

  it('returns only a short reference, never buyer details', async () => {
    const res = await handleVerifyRequest(post({ key: KEY, activate: true }), 'p', gumroad(200, { ...good(), purchase: { ...good().purchase, email: 'buyer@example.com' } }) as unknown as typeof fetch);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ valid: true, ref: 'abc123' });
    expect(text).not.toContain('example.com');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects other methods and malformed bodies', async () => {
    expect((await handleVerifyRequest(new Request('https://x/api', { method: 'GET' }), 'p')).status).toBe(405);
    expect((await handleVerifyRequest(new Request('https://x/api', { method: 'POST', body: '{nope' }), 'p')).status).toBe(400);
  });
});
